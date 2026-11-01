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
assert.match(injected[0].textContent, /--dsw-alias-bg-layer-2/, "pill surface uses the layer-2 token");
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
		conversationAge: () => "创建对话至今",
		seconds: () => `${params.seconds}秒`,
		minutes: () => `${params.minutes}分${params.seconds}秒`,
		hours: () => `${params.hours}小时`,
		hoursMinutes: () => `${params.hours}小时${params.minutes}分`
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
assert.equal(declarations.get("height"), "24px", "pill height matches the dashboard pills");
assert.equal(declarations.get("padding"), "0 8px", "pill padding matches");
assert.equal(declarations.get("gap"), "6px", "a 6px gap separates the leading glyph from the label");
assert.equal(declarations.get("border-radius"), "999px", "pill is fully rounded, not radius-sm");
assert.equal(declarations.get("corner-shape"), "round", "squircle corner shape matches");
assert.equal(declarations.get("font-size"), "12px", "pill text is 12px like its neighbours");
assert.equal(declarations.get("line-height"), "18px", "pill line box is 18px like its neighbours");
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
		a: { id: "a", projectionValues: { sessionStats: { llmMs: 3_600_000, toolMs: 0 } } },
		b: { id: "b", projectionValues: { sessionStats: { llmMs: 1_200_000, toolMs: 600_000 } } },
		c: {
			id: "c",
			origin: "subagent",
			projectionValues: { sessionStats: { llmMs: 60_000, toolMs: 0 } }
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
assert.match(classHtml, /class="xXe6ja_title"/, "the title row shares the built-in rule");
assert.match(classHtml, /class="xXe6ja_titleRule"/, "the separator shares the built-in rule");
assert.match(classHtml, /class="xXe6ja_details"/, "the detail grid shares the built-in rule");
assert.doesNotMatch(
	classHtml,
	/specific-menu/,
	"the copied inline surface steps aside once the shared class paints it"
);
assert.match(classHtml, /创建对话至今/, "the single detail row survives the swap");
assert.match(classHtml, /30分0秒/);

console.log("render smoke: closed-state and open-state assertions passed");
