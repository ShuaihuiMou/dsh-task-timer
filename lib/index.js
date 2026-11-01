import { z } from "zod";

/**
 * dsh-task-timer — host side.
 *
 * Working time itself is not folded here: it is the dashboard's own reading,
 * `sessionStats.llmMs + sessionStats.toolMs`, which the client already holds,
 * so re-deriving it would only create a second number that could drift.
 *
 * What the log does not carry is when the conversation started, and the client
 * never sees a Session header. This projection publishes exactly that: the
 * header's `createdAt`, taken at `init(header, inheritedEventCount)` — the one
 * place the framework hands the header to a projection.
 *
 * It also publishes the other end of that span: `lastActivityAt`, the time of
 * the newest event that moved the conversation forward (a message, a turn or
 * step boundary, a tool pair). The age the client shows is bounded by it, so a
 * conversation nobody has touched for hours keeps reading the same number
 * instead of growing one second at a time. Metadata events — title, settings,
 * archive flags — are deliberately outside the set: renaming a conversation is
 * not activity in it.
 *
 * The third figure is `awaitMs`: how much of the dashboard's tool time was
 * really the user's, i.e. the closed spans of calls that block for an answer
 * (`AWAIT_TOOLS`). `sessionStats` bills those spans as work, so the client
 * subtracts this total rather than reading it out as time the agent spent. An
 * idle conversation between turns needs no entry here — model and tool time
 * only ever run inside a turn, so that time was never billed in the first
 * place.
 *
 * @module dsh-task-timer
 */

/** Cordis plugin name (used as the default entry id when none is patched). */
const name = "task-timer";

/** The projection registry is this plugin's whole purpose. */
const inject = ["sessionProjections"];

/**
 * Events that mean the conversation itself moved: a message landing on the
 * surface, a turn/step boundary, or a tool pair. Everything else — `session`,
 * `session/title`, `session/settings`, compaction bookkeeping — is not
 * conversation time and must not restart the clock.
 */
const ACTIVITY_EVENTS = new Set([
	"user/message",
	"developer/message",
	"system/message",
	"turn/start",
	"turn/end",
	"step/start",
	"step/end",
	"assistant/attempt",
	"assistant/message",
	"tool/call",
	"tool/result"
]);

/**
 * Tools that hand the turn to the human and return only once they answer.
 *
 * The dashboard pairs every `tool/call` with its `tool/result` by `callId`, so
 * the whole wait for an answer is billed as tool time — a question left open
 * overnight would add eight hours of "work". No event marks the answer as the
 * user's rather than the tool's, so the call name is the only signal there is.
 */
const AWAIT_TOOLS = new Set(["ask_user_question", "request_user_input", "exit_plan_mode"]);

/**
 * Whether one tool call is spent waiting on the user.
 * @param toolName - `tool/call`'s recorded name, possibly MCP-qualified.
 * @returns true when the call blocks until a human answers.
 */
function awaitsUser(toolName) {
	if (typeof toolName !== "string") return false;
	// A bridged copy of the same tool arrives as `mcp__<server>__<tool>`; the
	// ask tools register under the bare name, so match the trailing segment.
	const cut = toolName.lastIndexOf("__");
	return AWAIT_TOOLS.has(cut === -1 ? toolName : toolName.slice(cut + 2));
}

/** Wire value served to clients. */
const taskTimerViewSchema = z.object({
	createdAt: z.number().nonnegative(),
	lastActivityAt: z.number().nonnegative(),
	awaitMs: z.number().nonnegative()
}).strict();

/** Persisted state: the two ends of the span, the deducted total, and open waits. */
const taskTimerStateSchema = z.object({
	createdAt: z.number().nonnegative(),
	lastActivityAt: z.number().nonnegative(),
	awaitMs: z.number().nonnegative(),
	awaitCalls: z.record(z.string(), z.number().nonnegative())
}).strict();

/**
 * The registry suppresses publication by comparing consecutive raw views with
 * `Object.is`, so one state reference must keep yielding one view reference.
 * Keying on the state object gives each cell its own cached view and lets the
 * entry disappear with the state it describes.
 */
const views = new WeakMap();

/**
 * Move the activity cursor to one event's time, keeping the reference when it
 * does not advance.
 * @param state - current fold state.
 * @param at - event time, possibly missing.
 * @returns the next state, or `state` itself when nothing moved.
 */
function advance(state, at) {
	// `!(at > cursor)` also screens out a missing or NaN clock, and the
	// monotonic test keeps a replayed out-of-order event from moving back.
	if (!(at > state.lastActivityAt)) return state;
	return { ...state, lastActivityAt: at };
}

const taskTimerProjectionDefinition = {
	key: "taskTimer",
	// v1 folded llmMs/toolMs, v2 published a bare `createdAt`, v3 added the
	// activity end; v4 adds the deducted answer wait. A row from any earlier
	// version must refold rather than restore — none of them carried this field.
	stateVersion: 4,
	stateSchema: taskTimerStateSchema,
	// A seeded fork replays its ancestor's prefix through `apply`, whose times
	// all predate this header. Seeding the cursor at `createdAt` keeps that
	// prefix from dragging the span back to a negative age.
	init: (header) => ({
		createdAt: header.createdAt,
		lastActivityAt: header.createdAt,
		awaitMs: 0,
		awaitCalls: {}
	}),
	apply: (state, event) => {
		if (!ACTIVITY_EVENTS.has(event.type)) return state;
		const at = event.time;
		const moved = advance(state, at);
		switch (event.type) {
			case "tool/call": {
				// An ask opens a wait now and closes it at its result; until then
				// `sessionStats` has counted nothing, so nothing is deducted yet.
				if (!awaitsUser(event.data?.name)) return moved;
				const callId = event.data?.callId;
				if (typeof callId !== "string") return moved;
				return { ...moved, awaitCalls: { ...moved.awaitCalls, [callId]: at } };
			}
			case "tool/result": {
				const callId = event.data?.message?.source?.callId;
				// Own-key check as in `sessionStats`: a provider-minted id that was
				// never an open ask leaves the state alone, inherited names included.
				if (typeof callId !== "string" || !Object.hasOwn(moved.awaitCalls, callId)) return moved;
				const { [callId]: started, ...awaitCalls } = moved.awaitCalls;
				// Paired exactly as `sessionStats` pairs it, so the deduction
				// cancels the same span the dashboard billed.
				return { ...moved, awaitCalls, awaitMs: moved.awaitMs + Math.max(0, at - started) };
			}
			case "turn/end":
				// An ask whose result never landed belongs to a cancelled or failed
				// turn, where `sessionStats` discards the call instead of timing it;
				// its wait is dropped the same way.
				return Object.keys(moved.awaitCalls).length === 0 ? moved : { ...moved, awaitCalls: {} };
			default:
				return moved;
		}
	},
	wire: {
		viewSchema: taskTimerViewSchema,
		view: (state) => {
			let cached = views.get(state);
			if (cached === void 0) {
				cached = {
					createdAt: state.createdAt,
					lastActivityAt: state.lastActivityAt,
					awaitMs: state.awaitMs
				};
				views.set(state, cached);
			}
			return cached;
		}
	}
};

/**
 * Register the `taskTimer` projection; registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
function apply(ctx) {
	ctx.sessionProjections.register(taskTimerProjectionDefinition);
}

export { apply, inject, name };
