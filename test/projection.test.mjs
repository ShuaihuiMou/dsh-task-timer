// Projection contract test for the host side.
//
// The projection does not fold working time (the dashboard's `sessionStats`
// already reports model + tool time); it publishes the two ends of the age span
// — when the conversation was created, and the newest event that moved it — plus
// the one part of the dashboard's tool time that was really the user's: the
// spans of calls that blocked until a human answered.
// These assertions pin the parts the registry depends on: `init` reads the
// header, only conversation events move the cursor, only ask calls open a wait,
// and `view` reuses its reference.
import assert from "node:assert/strict";
import { apply, name } from "../lib/index.js";

let captured = null;
apply({
	sessionProjections: {
		register(definition) {
			captured = definition;
		}
	}
});

assert.ok(captured !== null, "projection was registered");
assert.equal(name, "task-timer", "plugin name is stable");
assert.equal(captured.key, "taskTimer", "projection key is stable");
assert.equal(
	captured.stateVersion,
	5,
	"v1 (llmMs/toolMs), v2 (bare createdAt), v3 (activity end) and v4 (answer wait) rows must refold instead of restoring"
);

const { init, apply: fold, wire } = captured;
const HEADER = { id: "session-1", createdAt: 1_700_000_000_000 };
const T0 = HEADER.createdAt;

const state = init(HEADER, 0);
assert.deepEqual(
	state,
	{ createdAt: HEADER.createdAt, startedAt: 0, lastActivityAt: HEADER.createdAt, awaitMs: 0, awaitCalls: {} },
	"init takes the creation instant from the header, leaves the content start open, and starts the cursor there"
);
captured.stateSchema.parse(state);
assert.doesNotThrow(() => captured.stateSchema.parse(state), "state schema accepts the initial state");

// The inherited cut of a fork must not change the answer: a forked Session was
// created when its own header was written, not when its ancestor's log began.
const forked = init({ id: "session-2", createdAt: 1_800_000_000_000 }, 42);
assert.equal(forked.createdAt, 1_800_000_000_000, "a seeded prefix never rewrites the creation instant");

// A seeded prefix replays through `apply` with times that predate this header.
// The cursor is seeded at `createdAt`, so those events cannot drag the span
// backwards into a negative age.
const replayedPrefix = fold(forked, { type: "assistant/message", time: T0 + 500, data: {} });
assert.equal(replayedPrefix, forked, "an event older than the header leaves the cursor alone");
assert.equal(replayedPrefix.startedAt, 0, "an ancestor event never pins this conversation's start");

// A Session record is not a conversation. The desktop shell opens one at
// launch and the first message may arrive hours later — a real Session created
// at 19:55 and first used at 23:41 read 3h46m, for a conversation minutes old.
// The age therefore starts at the first event that carried content.
const idle = init(HEADER, 0);
const configured = fold(idle, { type: "permission/preset", time: T0 + 13_860_000, data: {} });
assert.equal(configured, idle, "session configuration is not conversation content");
const firstMessage = fold(configured, { type: "user/message", time: T0 + 13_869_000, data: { turn: 0 } });
assert.equal(firstMessage.createdAt, T0, "the record's creation instant is still reported");
assert.equal(firstMessage.startedAt, T0 + 13_869_000, "the first message starts the age, not the record");
const laterMessage = fold(firstMessage, { type: "assistant/message", time: T0 + 13_900_000, data: {} });
assert.equal(laterMessage.startedAt, T0 + 13_869_000, "the start is pinned once and never moves");

// Conversation events move the cursor; the newest one wins and the state
// reference changes exactly once per advance.
const events = [
	{ type: "user/message", time: T0 + 1, data: { turn: 0, step: null } },
	{ type: "step/start", time: T0 + 2, data: { turn: 0, step: 0 } },
	{ type: "assistant/message", time: T0 + 3000, data: { turn: 0, step: 0 } },
	{ type: "tool/call", time: T0 + 3001, data: { callId: "a", name: "bash" } },
	{ type: "tool/result", time: T0 + 5000, data: { message: { source: { callId: "a" } } } },
	{ type: "step/end", time: T0 + 5001, data: { turn: 0, step: 0 } },
	{ type: "turn/end", time: T0 + 5002, data: { turn: 0 } }
];
let cursor = state;
for (const event of events) {
	const next = fold(cursor, event);
	assert.notEqual(next, cursor, `${event.type} advances the cursor`);
	assert.equal(next.lastActivityAt, event.time, `${event.type} stamps its own time`);
	assert.equal(next.createdAt, T0, `${event.type} never moves the creation instant`);
	assert.equal(next.startedAt, T0 + 1, `${event.type} leaves the pinned start alone`);
	cursor = next;
}
assert.equal(cursor.lastActivityAt, T0 + 5002, "the last turn end is the newest end");
assert.equal(cursor.awaitMs, 0, "a plain tool call is work, never a wait on the user");

// Out of order and clock-less events are ignored, so the cursor is monotonic.
assert.equal(
	fold(cursor, { type: "tool/result", time: T0 + 10, data: {} }),
	cursor,
	"an older event cannot move the cursor back"
);
assert.equal(
	fold(cursor, { type: "assistant/message", data: {} }),
	cursor,
	"a missing clock is not activity"
);

// Metadata is not conversation time: renaming or re-configuring a Session must
// not restart its clock, which would make an idle conversation look busy.
for (const type of ["session/title", "session/settings", "session/end", "workspace/changes"]) {
	assert.equal(
		fold(cursor, { type, time: T0 + 900_000, data: {} }),
		cursor,
		`${type} is not conversation activity`
	);
}

const view = wire.view(cursor);
captured.wire.viewSchema.parse(view);
assert.deepEqual(
	view,
	{ createdAt: T0, startedAt: T0 + 1, lastActivityAt: T0 + 5002, awaitMs: 0 },
	"the wire view carries the span's two ends, the content start and the deducted wait"
);
assert.equal(wire.view(cursor), view, "an unchanged state reuses its view reference");
assert.notEqual(wire.view(init(HEADER, 0)), view, "a different cell gets its own view reference");

// Working time is deliberately absent: the dashboard's activity pill owns it,
// and a second copy here is exactly the duplication this projection removed.
assert.equal("llmMs" in view, false, "no model time is published");
assert.equal("toolMs" in view, false, "no tool time is published");
assert.equal("workingMs" in view, false, "no working total is published");
assert.equal("awaitCalls" in view, false, "open waits stay host-side");

// Answer waits. The dashboard pairs `tool/call` with `tool/result` by callId and
// bills the whole span as tool time, so a question left open overnight reads as
// eight hours of work. The fold keeps the closing time of every call that blocks
// on a human; the client subtracts the total.
const asked = fold(cursor, {
	type: "tool/call",
	time: T0 + 10_000,
	data: { callId: "ask-1", name: "ask_user_question" }
});
assert.notEqual(asked, cursor, "an ask is an activity event like any other");
assert.equal(asked.awaitMs, 0, "an open wait deducts nothing yet: the dashboard has not billed it");
assert.deepEqual(asked.awaitCalls, { "ask-1": T0 + 10_000 }, "the open ask is held until its result");

const answered = fold(asked, {
	type: "tool/result",
	time: T0 + 70_000,
	data: { message: { source: { callId: "ask-1" } } }
});
assert.equal(answered.awaitMs, 60_000, "the answered wait is exactly the call→result span");
assert.deepEqual(answered.awaitCalls, {}, "the closed wait leaves nothing behind");
assert.equal(
	wire.view(answered).awaitMs,
	60_000,
	"the deduction reaches the wire"
);

// A bridged copy of the same tool blocks on the user just the same; the trailing
// segment is the registered name.
const bridged = fold(cursor, {
	type: "tool/call",
	time: T0 + 1000,
	data: { callId: "ask-2", name: "mcp__dsh__ask_user_question" }
});
assert.deepEqual(bridged.awaitCalls, { "ask-2": T0 + 1000 }, "an MCP-qualified ask is recognised");

// Plan review is the same kind of wait: the tool returns only once the user has
// read the plan and answered.
const review = fold(cursor, {
	type: "tool/call",
	time: T0 + 1000,
	data: { callId: "plan-1", name: "exit_plan_mode" }
});
assert.deepEqual(review.awaitCalls, { "plan-1": T0 + 1000 }, "a plan review is a wait on the user too");

// Everything else is the agent's own work, whatever its name looks like.
for (const toolName of ["bash", "read", "pwsh", "mcp__dsh__pwsh", "task", "ask_user"]) {
	const plain = fold(cursor, {
		type: "tool/call",
		time: T0 + 1000,
		data: { callId: `plain-${toolName}`, name: toolName }
	});
	assert.deepEqual(plain.awaitCalls, {}, `${toolName} is work, not a wait`);
}

// A wait whose result never landed belongs to a cancelled or failed turn. The
// dashboard drops that call instead of timing it, so the wait cannot be
// deducted either — otherwise the reading would lose time it never gained.
const cancelled = fold(asked, { type: "turn/end", time: T0 + 80_000, data: { turn: 0 } });
assert.deepEqual(cancelled.awaitCalls, {}, "a cancelled ask is forgotten");
assert.equal(cancelled.awaitMs, 0, "a wait that never closed is never deducted");

// Right after a cancelled turn the same callId arriving late finds no open wait.
const straggler = fold(cancelled, {
	type: "tool/result",
	time: T0 + 90_000,
	data: { message: { source: { callId: "ask-1" } } }
});
assert.equal(straggler.awaitMs, 0, "a result with no recorded call cannot subtract anything");

// Two waits in one conversation accumulate rather than overwrite.
const second = fold(answered, {
	type: "tool/call",
	time: T0 + 100_000,
	data: { callId: "ask-3", name: "ask_user_question" }
});
const secondAnswered = fold(second, {
	type: "tool/result",
	time: T0 + 130_000,
	data: { message: { source: { callId: "ask-3" } } }
});
assert.equal(secondAnswered.awaitMs, 90_000, "waits add up across a conversation");

// A plain tool's result is not misread as closing an ask.
assert.equal(
	fold(answered, {
		type: "tool/result",
		time: T0 + 200_000,
		data: { message: { source: { callId: "ask-1" } } }
	}).awaitMs,
	60_000,
	"a duplicate result for a wait already closed adds nothing"
);

// The state survives a cache round-trip: the schema is the persisted boundary.
captured.stateSchema.parse(answered);
assert.doesNotThrow(
	() => captured.stateSchema.parse(secondAnswered),
	"the persisted state keeps the open-wait map"
);

console.log(
	"projection: createdAt + startedAt + lastActivityAt + awaitMs published, cursor monotonic, waits paired, view references stable"
);
