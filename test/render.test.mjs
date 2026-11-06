// Render smoke test for the client pill bundle.
//
// Loads `lib/client.js` through a stubbed module table (real react, stubbed
// primitives), mounts it with a stub cordis context, and renders the pill with
// react-dom/server. The assertions pin the pill to the exact numbers the
// dashboard pills next to it use, so a future edit cannot silently drift again.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** Pinned clock: the conversation below is exactly half an hour old. */
const NOW = 1_700_000_000_000;
const CREATED_AT = NOW - 1_800_000;
Date.now = () => NOW;

const react = await import("react");
const react_dom = await import("react-dom");
const jsx_runtime = await import("react/jsx-runtime");
const { renderToStaticMarkup } = await import("react-dom/server");

/** Minimal document so `apply` can mount its stylesheet. */
const injected = [];
/**
 * The built-in stat-dialog stylesheet, absent by default so the fallback path
 * is the one under test first; the last scenario mounts it.
 */
let stubStyleTag = null;
globalThis.document = {
	head: {
		append(element) {
			injected.push(element);
		}
	},
	createElement(tag) {
		return { tag, dataset: {}, textContent: "", remove() {} };
	},
	querySelector() {
		return stubStyleTag;
	},
	addEventListener() {},
	removeEventListener() {}
};

/** Captured factory from the bundle's loader call. */
let captured = null;
globalThis.window = {
	__ModuleLoader__: {
		load(entry) {
			captured = entry;
		}
	}
};

await import(new URL("../lib/client.js", import.meta.url).href);

assert.equal(captured?.id, "dsh-task-timer", "bundle registers under the package id");

const primitives = {
	useAnchoredPosition: () => null,
	useDismissOnOutsidePointer: () => {},
	// Stand-in for ui-primitives' clock glyph: the real one is an `<svg>` too,
	// so the markup assertions below see the same shape the app does.
	IconClockOutlineRegular: () => jsx_runtime.jsx("svg", { "data-icon": "clock" })
};

const table = {
	react,
	"react-dom": react_dom,
	"react/jsx-runtime": jsx_runtime,
	"@deepseek-ai/dsh-client-ui-primitives": primitives
};

const exportsOfBundle = captured.factory((id) => {
	if (!(id in table)) throw new Error(`unexpected import: ${id}`);
	return table[id];
});

assert.equal(typeof exportsOfBundle.apply, "function", "apply is exported");
assert.deepEqual(exportsOfBundle.inject, ["slots", "locale"], "inject lists slots and locale");

let registration = null;
let totalRegistration = null;
const translations = { zh: null, en: null };

/**
 * ui-workspace's own dictionary, stood in for the namespace the plugin binds to
 * label session rows. Swapped to `en` by the age-suffix scenario below to prove
 * the wording follows the app locale rather than a hard-coded suffix.
 */
const WORKSPACE_ZH = {
	"time.now": "刚刚",
	"time.minutes": "{n}分钟",
	"time.hours": "{n}小时",
	"time.days": "{n}天",
	"time.months": "{n}个月",
	"time.years": "{n}年",
	"time.ago": "{t}前"
};
const WORKSPACE_EN = {
	"time.now": "now",
	"time.minutes": "{n}min",
	"time.hours": "{n}h",
	"time.days": "{n}d",
	"time.months": "{n}mo",
	"time.years": "{n}y",
	"time.ago": "{t} ago"
};
let workspaceDict = WORKSPACE_ZH;
const workspaceCopy = (key, params = {}) => {
	const template = workspaceDict[key];
	if (template === void 0) return key;
	return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
};
const ctx = {
	effect(run) {
		return run();
	},
	locale: {
		register(namespace, dictionaries) {
			translations.namespace = namespace;
			translations.zh = dictionaries.zh;
			translations.en = dictionaries.en;
			return { dispose() {} };
		},
		bind(namespace) {
			assert.equal(namespace, "workspace", "the row labels come from ui-workspace's namespace");
			return (key, params) => workspaceCopy(key, params);
		}
	},
	slots: {
		inject(name, factory) {
			assert.ok(
				name === "conversation.composer.dock" || name === "sidebar.footer.action",
				`unexpected slot ${name}`
			);
			for (const entry of factory()) void entry;
		},
		register(options, component) {
			if (options.name === "conversation.composer.dock") {
				assert.equal(options.id, "task-timer");
				assert.equal(options.order, 2, "sits after the activity and usage pills");
				registration = component;
			} else {
				assert.equal(options.name, "sidebar.footer.action", "total lives above the account row");
				assert.equal(options.id, "task-timer-total");
				totalRegistration = component;
			}
			return { dispose() {} };
		}
	}
};

exportsOfBundle.apply(ctx);
assert.equal(typeof registration, "object", "pill component registered");
assert.ok(registration.$$typeof, "registration is a memo-wrapped react component");
assert.equal(translations.namespace, "taskTimer");
assert.equal(injected.length, 1, "one stylesheet mounted");
assert.match(injected[0].textContent, /\[data-dsh-task-timer-pill\]/, "pill stylesheet scoped by attribute");
assert.match(injected[0].textContent, /background: 0 0;/, "pill paints no surface of its own, like the dashboard pills beside it");
assert.doesNotMatch(injected[0].textContent, /--dsw-alias-bg-layer-2/, "an opaque layer token here would be the only filled chip in a translucent dock");
assert.match(injected[0].textContent, /color: var\(--dsw-alias-label-tertiary\)/, "label colour matches the neighbouring pills");
assert.match(injected[0].textContent, /\[aria-expanded="true"\][\s\S]*--dsw-alias-interactive-bg-hover/, "open state shares the hover fill");
assert.doesNotMatch(injected[0].textContent, /button-ghost-active/, "open state avoids the ghost active fill used elsewhere");

/** Render seat: projections and translate function the slot hands the pill. */
const projections = {
	// The slim header fact plus the newest conversation event. The cap sits on
	// `NOW` here, so the dialog reads the full half hour.
	taskTimer: { createdAt: CREATED_AT, lastActivityAt: NOW },
	// The dashboard's own reading, and now the pill's only source of working
	// time. Kept realistic (including decode figures) to prove it is not echoed.
	sessionStats: { llmMs: 120000, toolMs: 42000, decodeMs: 8000, decodeTokens: 4000 }
};

const t = (key, params = {}) => {
	const template = {
		workingTime: () => `${params.duration} · 工作时长`,
		title: () => "工作时长",
		total: () => `${params.duration} · 对话总时长`,
		totalTokens: () => `${params.count} · 对话总token`,
		thousand: () => `${params.value}K`,
		million: () => `${params.value}M`,
		conversationAge: () => "创建对话至今",
		awaitExcluded: () => "已扣除等待回答",
		seconds: () => `${params.seconds}秒`,
		minutes: () => `${params.minutes}分${params.seconds}秒`,
		hours: () => `${params.hours}小时`,
		hoursMinutes: () => `${params.hours}小时${params.minutes}分`,
		days: () => `${params.days}天`,
		daysHours: () => `${params.days}天${params.hours}小时`,
		years: () => `${params.years}年`,
		yearsDays: () => `${params.years}年${params.days}天`
	}[key];
	return template === void 0 ? key : template();
};

const html = renderToStaticMarkup(
	react.createElement(registration, {
		useProjection: (key) => projections[key],
		t
	})
);

const style = html.match(/<button[^>]*style="([^"]*)"/)?.[1] ?? "";
const declarations = new Map(
	style
		.split(";")
		.filter(Boolean)
		.map((entry) => {
			const at = entry.indexOf(":");
			return [entry.slice(0, at).trim(), entry.slice(at + 1).trim()];
		})
);

// Parity with ui-chat `StatsPills.module.css` `.pill`.
assert.equal(declarations.get("padding"), "1px 8px", "pill padding matches the dashboard pills");
assert.equal(declarations.get("gap"), "6px", "a 6px gap separates the leading glyph from the label");
assert.equal(declarations.has("height"), false, "height comes from padding plus the line box, as in `.pill`");
assert.equal(declarations.get("border-radius"), "var(--dsw-radius-sm)", "pill corners match the dashboard pills");
assert.equal(declarations.get("font-size"), "12px", "pill text is 12px like its neighbours");
assert.equal(declarations.get("line-height"), "20px", "pill line box is 20px like its neighbours");
assert.equal(declarations.get("font-weight"), "400", "pill text weight matches");
assert.equal(declarations.get("white-space"), "nowrap");
assert.equal(declarations.get("cursor"), "pointer");
assert.equal(declarations.get("font-variant-numeric"), "tabular-nums");
assert.equal(
	declarations.has("background") || declarations.has("color"),
	false,
	"colours stay in the stylesheet so hover and open states can win"
);

// Structure and content.
assert.match(html, /data-dsh-task-timer-pill=""/, "trigger carries the scoping attribute");
assert.match(html, /data-composer-stat="task-timer"/, "root keeps the dashboard stat marker");
assert.equal(
	(html.match(/<svg[^>]*data-icon="clock"/g) ?? []).length,
	1,
	"the trigger leads with the clock glyph, like the activity and usage pills"
);
assert.match(
	injected[0].textContent,
	/\[data-dsh-task-timer-pill\] svg \{[\s\S]*?width: 14px/,
	"the glyph is pinned to the dashboard pills' 14px"
);
assert.match(html, /2分42秒 · 工作时长/, "label leads with the duration, then the name, like the dashboard pills");
assert.match(html, /aria-label="2分42秒 · 工作时长"/, "accessible name carries the same value-first text");
assert.match(html, /aria-haspopup="dialog"/, "trigger opens a dialog");
assert.match(html, /aria-expanded="false"/, "starts closed");

// Nothing to show: no pill at all.
const empty = renderToStaticMarkup(
	react.createElement(registration, {
		useProjection: () => void 0,
		t
	})
);
assert.equal(empty, "", "renders nothing before any agent work is recorded");

// Duration widening: an hour never shows up as "89分", and once it does the
// seconds are dropped. The value comes from `sessionStats`, i.e. the same
// llmMs + toolMs pair the activity pill splits out.
const label = (workingMs) =>
	renderToStaticMarkup(
		react.createElement(registration, {
			useProjection: (key) =>
				key === "sessionStats" ? { llmMs: workingMs, toolMs: 0 } : void 0,
			t
		})
	);

assert.match(label(3_590_000), /59分50秒 · 工作时长/, "just under the hour still reads as minutes and seconds");
assert.match(label(3_600_000), /1小时 · 工作时长/, "exactly 60 minutes becomes one hour, never 60分");
assert.match(label(5_340_000), /1小时29分 · 工作时长/, "past the hour the seconds are dropped");
assert.doesNotMatch(label(5_340_000), /89分/, "minutes never overflow past 59");
assert.doesNotMatch(label(5_340_000), /秒/, "no seconds once hours are shown");

// Past a day the hours stop piling up: 100 hours reads as 4天4小时, not
// 100小时. Months are skipped entirely (30/31 days make the unit ambiguous),
// and 365 days becomes a year.
const DAY = 86_400_000;
assert.match(label(DAY), /1天 · 工作时长/, "exactly 24 hours is one day, not 24小时");
assert.match(label(100 * 3_600_000), /4天4小时 · 工作时长/, "100 hours widens into days and hours");
assert.doesNotMatch(label(100 * 3_600_000), /100小时/, "hours never overflow past 23 once days appear");
assert.doesNotMatch(label(100 * 3_600_000), /月/, "months are never used as a unit");
assert.match(label(365 * DAY), /1年 · 工作时长/, "365 days is exactly one year");
assert.match(label(366 * DAY), /1年1天 · 工作时长/, "a year keeps the leftover days");
assert.match(label(400 * DAY), /1年35天 · 工作时长/, "years widen with a day remainder");
assert.match(label(730 * DAY), /2年 · 工作时长/, "whole years drop the zero day remainder");
assert.doesNotMatch(label(400 * DAY), /月/, "no month unit at the year level either");

// Time spent waiting on an answer is not work. `sessionStats` bills a question's
// whole call→result span as tool time, so the host publishes that share as
// `taskTimer.awaitMs` and the pill subtracts it before formatting.
const billed = (stats, timer) =>
	renderToStaticMarkup(
		react.createElement(registration, {
			useProjection: (key) => (key === "sessionStats" ? stats : timer),
			t
		})
	);

assert.match(
	billed(
		{ llmMs: 120_000, toolMs: 420_000 },
		{ createdAt: CREATED_AT, lastActivityAt: NOW, awaitMs: 420_000 }
	),
	/2分0秒 · 工作时长/,
	"an answered question's wait comes off the reading, leaving only the model time"
);
assert.doesNotMatch(
	billed(
		{ llmMs: 120_000, toolMs: 420_000 },
		{ createdAt: CREATED_AT, lastActivityAt: NOW, awaitMs: 420_000 }
	),
	/9分0秒/,
	"the billed wait never shows up as work"
);
assert.match(
	billed({ llmMs: 120_000, toolMs: 42_000 }, { createdAt: CREATED_AT, lastActivityAt: NOW }),
	/2分42秒 · 工作时长/,
	"a host still serving the previous view shape charges the old number rather than NaN"
);
assert.equal(
	billed(
		{ llmMs: 120_000, toolMs: 42_000 },
		{ createdAt: CREATED_AT, lastActivityAt: NOW, awaitMs: 200_000 }
	),
	"",
	"a reading that a long wait would push below zero shows no pill instead of a negative time"
);

// Open state: reload the bundle with `useState` pinned open so the dialog body
// actually renders. The portal is flattened to inline markup, since
// react-dom/server refuses portals.
captured = null;
await import(`${new URL("../lib/client.js", import.meta.url).href}?open`);

let useStateCalls = 0;
const openReact = new Proxy(react, {
	get(target, key) {
		if (key === "useState") {
			// Pin the open flag only; the age clock keeps its real state so the
			// rendered value proves it is derived from `Date.now()`.
			return (initial) => {
				useStateCalls += 1;
				return useStateCalls === 1 ? [true, () => {}] : target.useState(initial);
			};
		}
		return target[key];
	}
});
const openDom = { ...react_dom, createPortal: (node) => node };
globalThis.document.body = {};

const openExports = captured.factory((id) => {
	if (id === "react") return openReact;
	if (id === "react-dom") return openDom;
	if (!(id in table)) throw new Error(`unexpected import: ${id}`);
	return table[id];
});
openExports.apply(ctx);

const openHtml = renderToStaticMarkup(
	react.createElement(registration, {
		useProjection: (key) => projections[key],
		t
	})
);

assert.match(openHtml, /role="dialog"/, "trigger opens the detail dialog");
assert.match(
	openHtml,
	/background:var\(--dsw-alias-bg-layer-2\)/,
	"the fallback panel paints the same opaque base as the shared-class path"
);
assert.equal(
	(openHtml.match(/<svg[^>]*data-icon="clock"/g) ?? []).length,
	2,
	"the glyph leads both the trigger and the dialog title, as in ui-chat's own pills"
);
assert.equal((openHtml.match(/<dt/g) ?? []).length, 1, "dialog lists exactly one detail");
assert.match(openHtml, /创建对话至今/, "the detail names the span it measures");
assert.match(openHtml, /30分0秒/, "the age is the newest activity minus the header's createdAt");
assert.doesNotMatch(openHtml, /模型时间|工具时间/, "the dashboard's own split is not repeated here");
assert.equal(
	/生成速度|Token|tok\/s/.test(openHtml),
	false,
	"dialog does not repeat the TPS and token totals the dashboard already shows"
);

// The dialog is the only place the age appears; the trigger keeps reporting
// working time, so the two numbers never get confused.
assert.match(openHtml, /2分42秒 · 工作时长/, "trigger still reads as working time");

// The cap: nothing has landed in this conversation for twenty minutes, so the
// reading stops at the last event instead of drifting to the pinned `NOW`.
useStateCalls = 0;
const idleHtml = renderToStaticMarkup(
	react.createElement(registration, {
		useProjection: (key) =>
			key === "taskTimer"
				? { createdAt: CREATED_AT, lastActivityAt: CREATED_AT + 600_000 }
				: projections[key],
		t
	})
);
assert.match(idleHtml, /创建对话至今/);
assert.match(idleHtml, /10分0秒/, "an idle conversation reads to its last message, not to now");
assert.doesNotMatch(idleHtml, /30分0秒/, "idle time after the last message never accrues");
assert.doesNotMatch(idleHtml, /20分0秒/, "the gap before the cap is not counted either");

// The Session record is not the conversation. The shell can open a record hours
// before anyone types in it — a real one was created at 19:55 and first used at
// 23:41, and measuring from the record made a minutes-old conversation read
// 3h50m. When the host pins `startedAt` to the first message, the age runs from
// there; without it (an older host), the record's instant is the fallback.
useStateCalls = 0;
const lateStartHtml = renderToStaticMarkup(
	react.createElement(registration, {
		useProjection: (key) =>
			key === "taskTimer"
				? { createdAt: CREATED_AT - 13_560_000, startedAt: CREATED_AT, lastActivityAt: NOW }
				: projections[key],
		t
	})
);
assert.match(lateStartHtml, /30分0秒/, "the age runs from the first message, not the record");
assert.doesNotMatch(lateStartHtml, /4小时16分/, "the idle hours before the first message are not counted");

// The dialog's "创建对话至今" span runs through the same formatter: 100+
// hours widen into days, and a year-long span into years and days. Months
// (30/31 days) are never a unit here either.
useStateCalls = 0;
const longAgeHtml = renderToStaticMarkup(
	react.createElement(registration, {
		useProjection: (key) =>
			key === "taskTimer"
				? {
					createdAt: NOW - 100 * 3_600_000,
					startedAt: NOW - 100 * 3_600_000,
					lastActivityAt: NOW
				}
				: projections[key],
		t
	})
);
assert.match(longAgeHtml, /4天4小时/, "the dialog age widens past a day");
assert.doesNotMatch(longAgeHtml, /100小时|月/, "the dialog never prints 100小时 or a month unit");

useStateCalls = 0;
const yearAgeHtml = renderToStaticMarkup(
	react.createElement(registration, {
		useProjection: (key) =>
			key === "taskTimer"
				? {
					createdAt: NOW - 400 * 86_400_000,
					startedAt: NOW - 400 * 86_400_000,
					lastActivityAt: NOW
				}
				: projections[key],
		t
	})
);
assert.match(yearAgeHtml, /1年35天/, "a 400-day age reads as years and days");
assert.doesNotMatch(yearAgeHtml, /400天|月/, "no bare 400天 and no month unit");

// The dialog names the deduction, so the smaller pill explains itself instead of
// quietly disagreeing with the dashboard's activity numbers.
useStateCalls = 0;
const deductedHtml = renderToStaticMarkup(
	react.createElement(registration, {
		useProjection: (key) =>
			key === "sessionStats"
				? { llmMs: 120_000, toolMs: 420_000 }
				: key === "taskTimer"
					? { createdAt: CREATED_AT, lastActivityAt: NOW, awaitMs: 420_000 }
					: void 0,
		t
	})
);
assert.match(deductedHtml, /2分0秒 · 工作时长/, "the trigger carries the narrowed reading");
assert.match(deductedHtml, /已扣除等待回答/, "the dialog explains what came off that reading");
assert.match(deductedHtml, /7分0秒/, "the deducted span is shown at the full value");
assert.doesNotMatch(deductedHtml, /9分0秒/, "the billed span is never offered as the total");
assert.equal((deductedHtml.match(/<dt/g) ?? []).length, 2, "the deduction is a second detail row");

// Background cadence: a live second hand while open, one poll a minute while
// closed. SSR cannot observe timers, so the shipped bundle is the evidence.
const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
assert.match(source, /OPEN_TICK_MS = 1e3/, "open dialog ticks once a second");
assert.match(source, /IDLE_TICK_MS = 6e4/, "background polls once a minute");
assert.match(source, /open \? OPEN_TICK_MS : IDLE_TICK_MS/, "the cadence switches with the dialog");
assert.match(source, /setNow\(Date\.now\(\)\);/, "opening refreshes the age immediately");
assert.match(source, /Math\.min\(now, lastActivityAt\)/, "the reading is capped by the last activity");
assert.match(source, /openedAt >= lastActivityAt/, "a capped reading keeps no timer alive");
assert.doesNotMatch(source, /llmTime|toolTime/, "the removed detail rows left no dead locale keys");
assert.match(
	source,
	/IconClockOutlineRegular \} = primitives/,
	"the leading glyph is ui-primitives' own clock, not a hand-rolled path"
);
assert.doesNotMatch(source, /<svg/, "no inline svg is shipped; the icon set owns the glyph");

// Sidebar total: sums every listed conversation's `sessionStats`, preferring
// the live projection over the checkpointed list value, and skipping subagent
// rows so a spawned Session is not billed twice.
const listState = (overrides = {}) => ({
	ids: ["a", "b", "c"],
	byId: {
		a: {
			id: "a",
			projectionValues: {
				sessionStats: { llmMs: 3_600_000, toolMs: 0 },
				tokenUsage: {
					uncachedInputTokens: 1_500_000,
					outputTokens: 500_000,
					cacheReadTokens: 1_000_000,
					cacheWriteTokens: 0
				}
			}
		},
		b: {
			id: "b",
			projectionValues: {
				sessionStats: { llmMs: 1_200_000, toolMs: 600_000 },
				tokenUsage: {
					uncachedInputTokens: 200_000,
					outputTokens: 100_000,
					cacheReadTokens: 0,
					cacheWriteTokens: 0
				}
			}
		},
		c: {
			id: "c",
			origin: "subagent",
			projectionValues: {
				sessionStats: { llmMs: 60_000, toolMs: 0 },
				tokenUsage: {
					uncachedInputTokens: 9_000_000,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0
				}
			}
		}
	},
	projectionsBySession: {},
	...overrides
});

const renderTotal = (state, wide = true) =>
	renderToStaticMarkup(
		react.createElement(totalRegistration, {
			wide,
			useSessions: (selector) => selector(state),
			t
		})
	);

const totalHtml = renderTotal(listState());
assert.match(totalHtml, /data-dsh-task-timer-total=""/, "total carries its own scoping attribute");
assert.match(totalHtml, /1小时30分 · 对话总时长/, "two conversations sum into one value-first caption");
assert.doesNotMatch(totalHtml, /data-icon/, "the caption is text only, with no clock glyph");
assert.doesNotMatch(totalHtml, /1小时31分/, "the subagent row is excluded from the total");

const totalStyle = totalHtml.match(/style="([^"]*)"/)?.[1] ?? "";
const totalDeclarations = new Map(
	totalStyle
		.split(";")
		.filter(Boolean)
		.map((entry) => {
			const at = entry.indexOf(":");
			return [entry.slice(0, at).trim(), entry.slice(at + 1).trim()];
		})
);
assert.equal(totalDeclarations.get("font-size"), "12px", "caption matches the sidebar's small text");
assert.equal(totalDeclarations.get("line-height"), "18px");
assert.equal(totalDeclarations.get("padding"), "0 10px", "symmetric padding now that the glyph is gone");
assert.equal(
	totalDeclarations.get("color"),
	"var(--dsw-alias-label-tertiary)",
	"caption stays quieter than the row below it"
);
assert.equal(totalDeclarations.get("user-select"), "none", "the caption cannot be dragged into a selection");
assert.equal(totalDeclarations.get("-webkit-user-select"), "none", "the webkit prefix carries the same lock");

// The token caption: same snapshot, second line, same compact scale as the
// host's own usage pill.
assert.match(
	totalHtml,
	/data-dsh-task-timer-total-tokens=""[\s\S]*3\.3M · 对话总token/,
	"billed tokens sum into a value-first caption below the time"
);
assert.ok(
	totalHtml.indexOf("对话总时长") < totalHtml.indexOf("对话总token"),
	"tokens render under the working time, not above it"
);
assert.doesNotMatch(totalHtml, /9M|12M/, "the subagent row's tokens are excluded from the total");
assert.equal(
	(totalHtml.match(/data-dsh-task-timer-total-tokens=""/g) ?? []).length,
	1,
	"one token caption, not one per row"
);
assert.match(
	renderTotal(
		listState({
			projectionsBySession: {
				b: {
					values: {
						tokenUsage: {
							uncachedInputTokens: 700_000,
							outputTokens: 0,
							cacheReadTokens: 0,
							cacheWriteTokens: 0
						}
					}
				}
			}
		})
	),
	/3\.7M · 对话总token/,
	"a live row's tokens win over its cached snapshot"
);

// A live Session row overrides its colder checkpointed value.
assert.match(
	renderTotal(
		listState({
			projectionsBySession: {
				a: { values: { sessionStats: { llmMs: 3_900_000, toolMs: 0 } } }
			}
		})
	),
	/1小时35分 · 对话总时长/,
	"the live projection wins over the cached list value"
);

// A row's answer wait comes off before the rows are summed. It belongs to that
// one conversation, so it cannot be separated out of the total afterwards.
const listWithWait = (waitRow) =>
	listState({
		byId: {
			a: { id: "a", projectionValues: { sessionStats: { llmMs: 3_600_000, toolMs: 0 } } },
			b: {
				id: "b",
				projectionValues: {
					sessionStats: { llmMs: 1_200_000, toolMs: 600_000 },
					taskTimer: { createdAt: 0, lastActivityAt: 0, awaitMs: waitRow }
				}
			},
			c: {
				id: "c",
				origin: "subagent",
				projectionValues: { sessionStats: { llmMs: 60_000, toolMs: 0 } }
			}
		}
	});

assert.match(
	renderTotal(listWithWait(600_000)),
	/1小时20分 · 对话总时长/,
	"one conversation's answer wait is deducted from its own share"
);
assert.match(
	renderTotal(listState()),
	/1小时30分 · 对话总时长/,
	"a row with no recorded wait is summed unchanged"
);

// A live row's wait overrides the colder snapshot the same way its stats do.
assert.match(
	renderTotal(
		listState({
			projectionsBySession: {
				b: {
					values: {
						sessionStats: { llmMs: 1_200_000, toolMs: 600_000 },
						taskTimer: { createdAt: 0, lastActivityAt: 0, awaitMs: 1_800_000 }
					}
				}
			}
		})
	),
	/1小时 · 对话总时长/,
	"a live row's wait is read from the live projection, not the checkpoint"
);

assert.equal(renderTotal(listState(), false), "", "the collapsed rail has no room for the caption");
assert.equal(
	renderTotal({ ids: [], byId: {}, projectionsBySession: {} }),
	"",
	"nothing is shown before any session has recorded work"
);

// Shared dialog styling: ui-chat's `stat-dialog.module.css` is what paints the
// 轮/步 dialog, so the panel adopts its hashed class names rather than a
// hand-copied surface. Mounting that stylesheet after the fallback renders above
// proves both paths live in one bundle instance.
stubStyleTag = {
	textContent:
		".xXe6ja_panel{z-index:1100;background:var(--dsw-specific-menu)}" +
		".xXe6ja_title{display:flex}" +
		".xXe6ja_titleRule{border-top:.5px solid var(--dsw-alias-border-l2)}" +
		".xXe6ja_details{display:grid}"
};

// Pinned open again: the counter above already spent its one open render.
useStateCalls = 0;
const classHtml = renderToStaticMarkup(
	react.createElement(registration, {
		useProjection: (key) => projections[key],
		t
	})
);

assert.match(classHtml, /class="xXe6ja_panel"/, "the panel takes the built-in dialog's own surface class");
// Themes cannot tell this popover from its sibling 轮/步 and 上下文已用 cards by
// class or role alone, so the card carries a hook a theme can use to keep this
// one opaque while the others keep their glass.
assert.match(classHtml, /data-dsh-task-timer-panel=""/, "the panel marks itself for theme-scoped fills");
assert.match(classHtml, /class="xXe6ja_title"/, "the title row shares the built-in rule");
assert.match(classHtml, /class="xXe6ja_titleRule"/, "the separator shares the built-in rule");
assert.match(classHtml, /class="xXe6ja_details"/, "the detail grid shares the built-in rule");
// The one property that is not shared: the surface film. Feeding it back as an
// inline base keeps the card a single colour instead of letting whatever the
// theme put behind the dock come through as a gradient.
assert.match(
	classHtml,
	/background:var\(--dsw-alias-bg-layer-2\)/,
	"the panel pins the dashboard cards' opaque fill"
);
assert.match(classHtml, /backdrop-filter:none/, "the backdrop stays out of the card");
assert.doesNotMatch(classHtml, /specific-menu/, "the translucent menu film is not painted here");
assert.match(classHtml, /创建对话至今/, "the single detail row survives the swap");
assert.match(classHtml, /30分0秒/);

// Session rows: the bare distance on the right of every row ("55分钟") reads as
// the time the conversation ran, not as when it last moved. ui-workspace owns
// that cell and its copy, with no slot to extend and no second dictionary
// allowed for its namespace, so the plugin re-labels the rendered text — and
// the wording comes from ui-workspace's own `time.ago` template, so the row and
// its hover card (`55分钟前`) agree.
const ELEMENT = 1;
const TEXT = 3;
const matchesSelector = (node, selector) =>
	selector === '[class$="_time"]' ? node.className.endsWith("_time") : node.className.includes("_sessionRow");

function fakeText(value) {
	const node = { nodeType: TEXT, nodeValue: value, parentNode: null };
	Object.defineProperty(node, "nextSibling", {
		get() {
			const siblings = node.parentNode?.childNodes ?? [];
			const at = siblings.indexOf(node);
			return at < 0 || at + 1 >= siblings.length ? null : siblings[at + 1];
		}
	});
	return node;
}

function fakeElement(className, childNodes = []) {
	const el = {
		nodeType: ELEMENT,
		className,
		childNodes: [],
		parentNode: null,
		get firstChild() {
			return el.childNodes[0] ?? null;
		},
		matches: (selector) => matchesSelector(el, selector),
		closest(selector) {
			let node = el;
			while (node !== null && node !== void 0 && node.nodeType === ELEMENT) {
				if (matchesSelector(node, selector)) return node;
				node = node.parentNode;
			}
			return null;
		},
		querySelectorAll(selector) {
			const found = [];
			const walk = (node) => {
				for (const child of node.childNodes ?? []) {
					if (child.nodeType !== ELEMENT) continue;
					if (matchesSelector(child, selector)) found.push(child);
					walk(child);
				}
			};
			walk(el);
			return found;
		}
	};
	for (const child of childNodes) {
		el.childNodes.push(child);
		child.parentNode = el;
	}
	return el;
}

/** One session row: title, then the trailing cell that carries the age. */
function fakeRow(label) {
	const text = fakeText(label);
	const cell = fakeElement("wnFoaW_time", [text]);
	const row = fakeElement("wnFoaW_sessionRow", [fakeElement("wnFoaW_title", [fakeText("标题")]), cell]);
	return { row, cell, text };
}

const observers = [];
globalThis.MutationObserver = class {
	constructor(callback) {
		this.callback = callback;
		observers.push(this);
	}
	observe(target, options) {
		this.target = target;
		this.options = options;
	}
	disconnect() {
		this.disconnected = true;
	}
	deliver(records) {
		this.callback(records);
	}
};

const existing = fakeRow("55分钟");
const untouchedNow = fakeRow("刚刚");
const untouchedPending = fakeRow("待回答");
const chatClock = fakeElement("hSzSIW_time", [fakeText("55分钟")]);
globalThis.document.body = fakeElement("body", [existing.row, untouchedNow.row, untouchedPending.row, chatClock]);

const ageCtx = {
	effect: (run) => run(),
	locale: {
		register: () => ({ dispose() {} }),
		bind: () => (key, params) => workspaceCopy(key, params)
	},
	slots: { inject() {}, register: () => ({ dispose() {} }) }
};

exportsOfBundle.apply(ageCtx);

assert.equal(existing.text.nodeValue, "55分钟前", "a bare distance on screen at load becomes an age");
assert.equal(untouchedNow.text.nodeValue, "刚刚", "the now bucket already reads as an instant");
assert.equal(untouchedPending.text.nodeValue, "待回答", "a pending-status word in the same cell is left alone");
assert.equal(chatClock.firstChild.nodeValue, "55分钟", "the same class on a chat message is out of reach");

const ageObserver = observers.at(-1);
assert.deepEqual(
	{ childList: ageObserver.options.childList, subtree: ageObserver.options.subtree, characterData: ageObserver.options.characterData },
	{ childList: true, subtree: true, characterData: true },
	"the observer watches rows being added and their labels being rewritten"
);

// Rows that arrive after the plugin loaded are labelled as they mount.
const later = fakeRow("2小时");
ageObserver.deliver([{ type: "childList", addedNodes: [later.row] }]);
assert.equal(later.text.nodeValue, "2小时前", "a row added later is labelled on the same commit that mounts it");

// The plugin's own write bounces back through the observer: it must stop there
// rather than append a second suffix.
ageObserver.deliver([{ type: "characterData", target: existing.text }]);
assert.equal(existing.text.nodeValue, "55分钟前", "re-entering with the suffixed label changes nothing");

// Locale switch: the suffix follows the dictionary, not a hard-coded 前.
workspaceDict = WORKSPACE_EN;
const english = fakeRow("55min");
ageObserver.deliver([{ type: "childList", addedNodes: [english.row] }]);
assert.equal(english.text.nodeValue, "55min ago", "the English row reads as an age too");
assert.equal(existing.text.nodeValue, "55分钟前", "a row that has not re-rendered keeps its own locale's label");

// Host without a MutationObserver (a non-browser harness) must not throw.
globalThis.MutationObserver = void 0;
assert.doesNotThrow(() => exportsOfBundle.apply(ageCtx), "a harness without MutationObserver is tolerated");

const ageSource = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
assert.match(ageSource, /ctx\.locale\.bind\("workspace"\)/, "the row copy is read from ui-workspace's namespace");
assert.match(ageSource, /node\.nodeValue = next/, "the label is rewritten in place, so React keeps writing to a live node");
assert.doesNotMatch(ageSource, /textContent = next/, "replacing the cell's children would detach the node React holds");

console.log("render smoke: closed-state and open-state assertions passed");
