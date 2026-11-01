// Projection contract test for the host side.
//
// The projection no longer folds working time (the dashboard's `sessionStats`
// already reports model + tool time); it publishes the two ends of the age span
// — when the conversation was created, and the newest event that moved it — so
// the client can show a number that stops when the conversation goes idle.
// These assertions pin the parts the registry depends on: `init` reads the
// header, only conversation events move the cursor, and `view` reuses its
// reference.
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
	3,
	"v1 (llmMs/toolMs) and v2 (bare createdAt) rows must refold instead of restoring"
);

const { init, apply: fold, wire } = captured;
const HEADER = { id: "session-1", createdAt: 1_700_000_000_000 };

const state = init(HEADER, 0);
assert.deepEqual(
	state,
	{ createdAt: HEADER.createdAt, lastActivityAt: HEADER.createdAt },
	"init takes the creation instant from the header and starts the cursor there"
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
const replayedPrefix = fold(forked, { type: "assistant/message", time: 1_700_000_000_500, data: {} });
assert.equal(replayedPrefix, forked, "an event older than the header leaves the cursor alone");

// Conversation events move the cursor; the newest one wins and the state
// reference changes exactly once per advance.
const events = [
	{ type: "user/message", time: HEADER.createdAt + 1, data: { turn: 0, step: null } },
	{ type: "step/start", time: HEADER.createdAt + 2, data: { turn: 0, step: 0 } },
	{ type: "assistant/message", time: HEADER.createdAt + 3000, data: { turn: 0, step: 0 } },
	{ type: "tool/call", time: HEADER.createdAt + 3001, data: { callId: "a" } },
	{ type: "tool/result", time: HEADER.createdAt + 5000, data: { message: { source: { callId: "a" } } } },
	{ type: "step/end", time: HEADER.createdAt + 5001, data: { turn: 0, step: 0 } },
	{ type: "turn/end", time: HEADER.createdAt + 5002, data: { turn: 0 } }
];
let cursor = state;
for (const event of events) {
	const next = fold(cursor, event);
	assert.notEqual(next, cursor, `${event.type} advances the cursor`);
	assert.equal(next.lastActivityAt, event.time, `${event.type} stamps its own time`);
	assert.equal(next.createdAt, HEADER.createdAt, `${event.type} never moves the creation instant`);
	cursor = next;
}
assert.equal(cursor.lastActivityAt, HEADER.createdAt + 5002, "the last turn end is the newest end");

// Out of order and clock-less events are ignored, so the cursor is monotonic.
assert.equal(
	fold(cursor, { type: "tool/result", time: HEADER.createdAt + 10, data: {} }),
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
		fold(cursor, { type, time: HEADER.createdAt + 900_000, data: {} }),
		cursor,
		`${type} is not conversation activity`
	);
}

const view = wire.view(cursor);
captured.wire.viewSchema.parse(view);
assert.deepEqual(
	view,
	{ createdAt: HEADER.createdAt, lastActivityAt: HEADER.createdAt + 5002 },
	"the wire view carries both ends of the span"
);
assert.equal(wire.view(cursor), view, "an unchanged state reuses its view reference");
assert.notEqual(wire.view(init(HEADER, 0)), view, "a different cell gets its own view reference");

// Working time is deliberately absent: the dashboard's activity pill owns it,
// and a second copy here is exactly the duplication this version removed.
assert.equal("llmMs" in view, false, "no model time is published");
assert.equal("toolMs" in view, false, "no tool time is published");
assert.equal("workingMs" in view, false, "no working total is published");

console.log("projection: createdAt + lastActivityAt published, cursor monotonic, view references stable");
