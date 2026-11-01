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

/** Wire value served to clients. */
const taskTimerViewSchema = z.object({
	createdAt: z.number().nonnegative(),
	lastActivityAt: z.number().nonnegative()
}).strict();

/** Persisted state: the two ends of the span, both monotonic. */
const taskTimerStateSchema = z.object({
	createdAt: z.number().nonnegative(),
	lastActivityAt: z.number().nonnegative()
}).strict();

/**
 * The registry suppresses publication by comparing consecutive raw views with
 * `Object.is`, so one state reference must keep yielding one view reference.
 * Keying on the state object gives each cell its own cached view and lets the
 * entry disappear with the state it describes.
 */
const views = new WeakMap();

const taskTimerProjectionDefinition = {
	key: "taskTimer",
	// v3: v1 folded llmMs/toolMs and v2 published a bare `createdAt`; both must
	// refold rather than restore, since neither carried the activity end.
	stateVersion: 3,
	stateSchema: taskTimerStateSchema,
	// A seeded fork replays its ancestor's prefix through `apply`, whose times
	// all predate this header. Seeding the cursor at `createdAt` keeps that
	// prefix from dragging the span back to a negative age.
	init: (header) => ({ createdAt: header.createdAt, lastActivityAt: header.createdAt }),
	apply: (state, event) => {
		if (!ACTIVITY_EVENTS.has(event.type)) return state;
		const at = event.time;
		// `!(at > cursor)` also screens out a missing or NaN clock, and the
		// monotonic test keeps a replayed out-of-order event from moving back.
		if (!(at > state.lastActivityAt)) return state;
		return { ...state, lastActivityAt: at };
	},
	wire: {
		viewSchema: taskTimerViewSchema,
		view: (state) => {
			let cached = views.get(state);
			if (cached === void 0) {
				cached = { createdAt: state.createdAt, lastActivityAt: state.lastActivityAt };
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
