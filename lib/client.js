window.__ModuleLoader__.load({
	id: "dsh-task-timer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react_jsx_runtime = require("react/jsx-runtime");
		const react = require("react");
		const react_dom = require("react-dom");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const { memo, useState, useRef, useEffect } = react;
		const { jsx, jsxs } = react_jsx_runtime;
		const { useAnchoredPosition, useDismissOnOutsidePointer, IconClockOutlineRegular } = primitives;

		//#region locale
		const NS = "taskTimer";
		const zh = {
			"workingTime": "{duration} · 工作时长",
			"title": "工作时长",
			"total": "{duration} · 对话总时长",
			"conversationAge": "创建对话至今",
			"awaitExcluded": "已扣除等待回答",
			"seconds": "{seconds}秒",
			"minutes": "{minutes}分{seconds}秒",
			"hours": "{hours}小时",
			"hoursMinutes": "{hours}小时{minutes}分"
		};
		const en = {
			"workingTime": "{duration} · Working time",
			"title": "Working time",
			"total": "{duration} · Conversation total",
			"conversationAge": "Since conversation start",
			"awaitExcluded": "Answer wait, excluded",
			"seconds": "{seconds}s",
			"minutes": "{minutes}m{seconds}s",
			"hours": "{hours}h",
			"hoursMinutes": "{hours}h{minutes}m"
		};
		//#endregion

		//#region formatting helpers
		/**
		 * Compact duration, widening one unit at a time: 45.2s under a minute,
		 * 2m42s up to the hour mark, then 1h29m — an hour never rolls up into
		 * "89分", and once hours appear the seconds are dropped.
		 * @param ms - milliseconds.
		 * @param t - translate seat.
		 */
		function formatDuration(ms, t) {
			const s = ms / 1e3;
			if (s < 60) return t("seconds", { seconds: Math.round(s * 10) / 10 });
			const whole = Math.round(s);
			const minutes = Math.floor(whole / 60);
			if (minutes < 60) return t("minutes", { minutes, seconds: whole % 60 });
			const hours = Math.floor(minutes / 60);
			const rest = minutes % 60;
			return rest === 0 ? t("hours", { hours }) : t("hoursMinutes", { hours, minutes: rest });
		}
		//#endregion

		//#region presentation
		/*
		 * Every number below is copied from the dashboard pills this one sits
		 * beside, so the two render at the same scale:
		 *
		 * - pill box: ui-chat `StatsPills.module.css` `.pill`
		 *   (22px tall from 1px/8px padding + a 20px line box, `radius-sm`,
		 *   12px text, `label-tertiary`, and no fill at rest — the neighbouring
		 *   pills paint nothing and only take `interactive-bg-hover` on hover),
		 *   plus the leading glyph and its 6px gap, so the trigger reads like
		 *   the activity and usage pills beside it rather than as bare text.
		 *   A fill here is what made this pill the one opaque chip in a
		 *   translucent dock under the Open Sea skin.
		 * - dialog: ui-chat `stat-dialog.module.css` `.panel` / `.title` /
		 *   `.titleRule` / `.titleLabel` / `.details`. Those class names are
		 *   hashed per build, so they are read back from the stylesheet ui-chat
		 *   mounts and applied directly — the 轮/步 dialog and this one then share
		 *   one set of rules. The inline copies below only run when that
		 *   stylesheet is absent.
		 * - dialog fill: not shared. See `PANEL_BASE`.
		 * - placement: ui-chat `useStatDialog` (side top, 8px gap, 12px margin)
		 */

		/**
		 * ui-chat's detail-dialog stylesheet id, as its plugin mounts it.
		 * @see statDialogClassesNow
		 */
		const STAT_DIALOG_CSS = "@deepseek-ai/dsh-client-ui-chat/stat-dialog.module.css";
		/** Resolved class names, kept once a stylesheet has answered. */
		let statDialogClasses;

		/**
		 * Read the built-in stat-dialog class names out of the stylesheet ui-chat
		 * mounted, so the panel is painted by the same rules as the 轮/步 dialog
		 * (surface, radius, padding, rule and grid) instead of by a hand-copied
		 * approximation of them. A missing stylesheet returns `null` and is not
		 * cached, so a late mount is still picked up.
		 * @returns the class-name map, or null when ui-chat is not mounted.
		 */
		function statDialogClassesNow() {
			if (statDialogClasses !== void 0) return statDialogClasses;
			let classes = null;
			try {
				const tag = document.querySelector(`style[data-plugin-css=${JSON.stringify(STAT_DIALOG_CSS)}]`);
				const text = tag === null || tag === void 0 ? "" : tag.textContent ?? "";
				const found = /\.([A-Za-z0-9_-]+)_panel\{/.exec(text);
				if (found !== null) {
					const prefix = found[1];
					classes = {
						panel: `${prefix}_panel`,
						title: `${prefix}_title`,
						titleLabel: `${prefix}_titleLabel`,
						titleValue: `${prefix}_titleValue`,
						titleRule: `${prefix}_titleRule`,
						details: `${prefix}_details`
					};
				}
			} catch {
				classes = null;
			}
			if (classes !== null) statDialogClasses = classes;
			return classes;
		}

		/** Hover and open-state treatment, the `.interactive`/`.active` pair. */
		const PILL_CSS = `[data-dsh-task-timer-pill] {
	background: 0 0;
	color: var(--dsw-alias-label-tertiary);
}
[data-dsh-task-timer-pill] svg {
	flex: none;
	width: 14px;
	height: 14px;
}
[data-dsh-task-timer-pill]:hover,
[data-dsh-task-timer-pill][aria-expanded="true"] {
	background: var(--dsw-alias-interactive-bg-hover);
	color: var(--dsw-alias-label-secondary);
}`;

		/**
		 * The leading glyph, shared by the trigger and the dialog title the way
		 * ui-chat's own pills reuse one icon element in both seats.
		 */
		const PILL_ICON = jsx(IconClockOutlineRegular, {});
		/** The label slot inside the trigger: one line, ellipsised. */
		const PILL_LABEL_STYLE = {
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis"
		};

		/** Trigger layout only; colour comes from `PILL_CSS` so hover can win. */
		const PILL_STYLE = {
			boxSizing: "border-box",
			display: "inline-flex",
			alignItems: "center",
			gap: "6px",
			padding: "1px 8px",
			border: "none",
			borderRadius: "var(--dsw-radius-sm)",
			fontFamily: "inherit",
			fontSize: "12px",
			fontWeight: 400,
			lineHeight: "20px",
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap",
			cursor: "pointer"
		};
		const ROOT_STYLE = {
			minWidth: 0,
			display: "inline-flex"
		};
		/**
		 * The panel's base fill, and the one property this dialog does not take
		 * from the shared class.
		 *
		 * `stat-dialog` paints its surface with `--dsw-specific-menu`: a
		 * translucent menu film plus `--dsw-menu-backdrop-filter`. A narrow card
		 * over a flat gap reads as one colour, but this one runs up to 440px wide,
		 * so whatever sits behind it — a theme wallpaper, the ocean skin's
		 * canvas, the composer's fade — reaches the eye through that film as a
		 * gradient instead of a base colour. The dashboard's own cards are opaque
		 * `--dsw-alias-bg-layer-2`, so the panel pins that same fill and drops the
		 * blur: one flat base colour in light and dark alike, whatever the theme
		 * puts behind the dock.
		 */
		const PANEL_BASE = {
			// In the base themes the layer-2 card fill is opaque. Themes that tint
			// the workspace glass repaint layer-2 with an alpha, so the card also
			// carries `data-dsh-task-timer-panel`: a theme that turns every popover
			// translucent can resume an opaque fill for this one card without
			// flattening its neighbours (the 轮/步, usage and 上下文已用 panels).
			background: "var(--dsw-alias-bg-layer-2)",
			backdropFilter: "none"
		};
		/** Fallback surface, used only while ui-chat's stylesheet is missing. */
		const PANEL_STYLE = {
			position: "fixed",
			zIndex: 1100,
			boxSizing: "border-box",
			width: "max-content",
			minWidth: "min(300px, 100vw - 24px)",
			maxWidth: "min(440px, 100vw - 24px)",
			padding: "16px",
			border: 0,
			borderRadius: "var(--dsw-radius-lg)",
			"--dsw-elevation-stroke-color": "var(--dsw-alias-border-l1)",
			boxShadow: "var(--dsw-elevation-prominent)",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "default",
			fontSize: "12px",
			lineHeight: "18px"
		};
		/** Unplaced panel: laid out but invisible, so the clamp can measure it. */
		const MEASURE_STYLE = {
			visibility: "hidden",
			left: 0,
			top: 0
		};
		const TITLE_STYLE = {
			display: "flex",
			justifyContent: "space-between",
			gap: "16px",
			marginBottom: "8px",
			fontWeight: 500,
			color: "var(--dsw-alias-label-primary)"
		};
		const TITLE_LABEL_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			gap: "6px",
			minWidth: 0
		};
		const TITLE_VALUE_STYLE = {
			fontVariantNumeric: "tabular-nums"
		};
		const RULE_STYLE = {
			borderTop: ".5px solid var(--dsw-alias-border-l2)",
			marginBottom: "10px"
		};
		const DETAILS_STYLE = {
			display: "grid",
			gridTemplateColumns: "minmax(76px, auto) minmax(0, 1fr)",
			gap: "6px 16px",
			margin: 0,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const DT_STYLE = {
			margin: 0,
			minWidth: 0
		};
		const DD_STYLE = {
			margin: 0,
			minWidth: 0,
			textAlign: "right",
			color: "var(--dsw-alias-label-secondary)",
			fontVariantNumeric: "tabular-nums"
		};
		/** Trigger-to-panel distance, matching `PANEL_GAP` in ui-chat. */
		const PANEL_GAP = 8;
		/** Viewport margin the placement clamp keeps. */
		const PANEL_MARGIN = 12;
		/** Open dialog cadence: the age reads as a live second hand. */
		const OPEN_TICK_MS = 1e3;
		/** Background cadence: one poll a minute keeps the age warm for the next open. */
		const IDLE_TICK_MS = 6e4;

		/**
		 * The working-time pill, injected into `conversation.composer.dock` beside
		 * the existing activity (TPS) and usage (tokens) pills.
		 *
		 * The number is the dashboard's own `sessionStats` reading — model time
		 * plus tool time — less the one part of it that was never the agent's:
		 * the span of every call that blocked until a human answered. Both halves
		 * come from the log through the slim `taskTimer` projection, so no second
		 * fold of the event stream is kept here. The dialog does not repeat model
		 * or tool time; it adds what the dashboard has no room for — how long the
		 * conversation has existed (its first message to the newest event that
		 * moved it) and how much of the reading was spent waiting on you.
		 *
		 * That end is a cap, not a clock reading: once the last message has
		 * finished and nothing new lands, the age holds still — an idle
		 * conversation must not accrue time it never spent. While a turn is
		 * running its boundary events keep moving the cap, so the number still
		 * advances during work.
		 */
		const WorkingTimePill = memo(function WorkingTimePill({ useProjection, t }) {
			const stats = useProjection("sessionStats");
			const timer = useProjection("taskTimer");

			// The dashboard bills a question's whole call→result span as tool time,
			// so the wait for an answer arrives here as work. `awaitMs` is that
			// share of it, folded host-side by pairing the calls that block on a
			// human; subtracting it keeps the pill about the agent's own time.
			// `?? 0` covers a host still serving the previous view shape, where a
			// bare subtraction would poison the reading with NaN.
			const awaitMs = timer === void 0 ? 0 : (timer.awaitMs ?? 0);
			const workingMs = stats === void 0 ? 0 : Math.max(0, stats.llmMs + stats.toolMs - awaitMs);
			const createdAt = timer === void 0 ? 0 : timer.createdAt;
			// Where the age starts: the first message of this conversation, not
			// the Session record. The shell can open a Session hours before anyone
			// types in it, and measuring from the record made a minutes-old
			// conversation read as 3h50m. `createdAt` remains the fallback for a
			// Session whose log has no conversation content yet.
			const startedAt = timer !== void 0 && timer.startedAt > 0 ? timer.startedAt : createdAt;
			const lastActivityAt = timer === void 0 ? 0 : timer.lastActivityAt;

			const [open, setOpen] = useState(false);
			const [now, setNow] = useState(Date.now);
			const rootRef = useRef(null);
			const panelRef = useRef(null);
			const pos = useAnchoredPosition({
				open,
				anchorRef: rootRef,
				panelRef,
				side: "top",
				gap: PANEL_GAP,
				margin: PANEL_MARGIN
			});
			useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);

			useEffect(() => {
				if (!(startedAt > 0)) return;
				const openedAt = Date.now();
				setNow(openedAt);
				// Already capped: the conversation has not moved since its last
				// message, so there is nothing to tick toward and no timer to keep.
				// A new event moves `lastActivityAt`, which restarts this effect.
				if (lastActivityAt > 0 && openedAt >= lastActivityAt) return;
				const id = setInterval(() => setNow(Date.now()), open ? OPEN_TICK_MS : IDLE_TICK_MS);
				return () => clearInterval(id);
			}, [open, startedAt, lastActivityAt]);

			useEffect(() => {
				if (!open) return;
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("keydown", onKey);
				return () => document.removeEventListener("keydown", onKey);
			}, [open]);

			if (workingMs <= 0) return null;

			const duration = formatDuration(workingMs, t);

			/**
			 * The built-in dialog's own class names when ui-chat is mounted: the
			 * panel then inherits the exact surface the 轮/步 dialog uses, and the
			 * inline copies below stay out of its way. `null` falls back to them.
			 */
			const skin = statDialogClassesNow();
			/** One set of layout props: the shared class, or the local copy. */
			const dressed = (className, style) =>
				skin === null ? { style } : { className: skin[className] };

			/** The one detail row: first message through the last activity. */
			const rows = [];
			if (startedAt > 0) {
				// `min` is the cap: the reading never runs past the newest event, so
				// an idle conversation shows the instant its last message finished.
				const endAt = lastActivityAt > 0 ? Math.min(now, lastActivityAt) : now;
				rows.push(jsx("dt", { style: skin === null ? DT_STYLE : void 0, children: t("conversationAge") }, "age"));
				rows.push(jsx("dd", {
					style: skin === null ? DD_STYLE : void 0,
					children: formatDuration(Math.max(0, endAt - startedAt), t)
				}, "age-value"));
			}
			// Named only when there is something to name, and only as a deduction:
			// the pill above already narrowed the reading, so this row explains
			// the gap against the dashboard's own activity numbers instead of
			// offering a second total to compare.
			if (awaitMs > 0) {
				rows.push(jsx("dt", { style: skin === null ? DT_STYLE : void 0, children: t("awaitExcluded") }, "await"));
				rows.push(jsx("dd", {
					style: skin === null ? DD_STYLE : void 0,
					children: formatDuration(awaitMs, t)
				}, "await-value"));
			}

			return jsxs("span", {
				ref: rootRef,
				style: ROOT_STYLE,
				"data-composer-stat": "task-timer",
				children: [
					jsxs("button", {
						type: "button",
						"data-dsh-task-timer-pill": "",
						style: PILL_STYLE,
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						"aria-label": `${duration} · ${t("title")}`,
						// Stamp the clock in the click itself so the first paint of the
						// dialog is already current, not one effect frame behind.
						onClick: () => {
							setNow(Date.now());
							setOpen(!open);
						},
						children: [
							PILL_ICON,
							jsx("span", { style: PILL_LABEL_STYLE, children: t("workingTime", { duration }) }, "label")
						]
					}, "pill"),
					open && react_dom.createPortal(jsxs("div", {
						...(skin === null ? {} : { className: skin.panel }),
						ref: panelRef,
						// Stable hook for themes that paint their own surfaces: the
						// Ocean skin keeps popovers glassy and gives this one card an
						// opaque fill instead.
						"data-dsh-task-timer-panel": "",
						role: "dialog",
						"aria-label": t("title"),
						style: { ...PANEL_BASE, ...(skin === null ? PANEL_STYLE : {}), ...(pos ?? MEASURE_STYLE) },
						children: [
							jsxs("div", {
								...dressed("title", TITLE_STYLE),
								children: [
									jsxs("span", {
										...dressed("titleLabel", TITLE_LABEL_STYLE),
										children: [PILL_ICON, t("title")]
									}, "label"),
									jsx("span", {
										...dressed("titleValue", TITLE_VALUE_STYLE),
										children: duration
									}, "value")
								]
							}, "title"),
							rows.length === 0 ? null : jsx("div", {
								...dressed("titleRule", RULE_STYLE),
								"aria-hidden": true
							}, "rule"),
							rows.length === 0 ? null : jsx("dl", {
								...dressed("details", DETAILS_STYLE),
								children: rows
							}, "details")
						]
					}), document.body, "panel")
				]
			});
		});

		/** Caption layout for the sidebar total; colour comes from tokens. */
		const TOTAL_STYLE = {
			display: "flex",
			alignItems: "center",
			boxSizing: "border-box",
			height: "24px",
			margin: "0 -2px",
			padding: "0 10px",
			minWidth: 0,
			color: "var(--dsw-alias-label-tertiary)",
			fontFamily: "inherit",
			fontSize: "12px",
			fontWeight: 400,
			lineHeight: "18px",
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap",
			overflow: "hidden",
			// A reading, not text to copy: a drag across the sidebar must not
			// select it.
			userSelect: "none",
			WebkitUserSelect: "none"
		};
		const TOTAL_TEXT_STYLE = {
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis"
		};

		/**
		 * Sum every conversation's working time from the Session list snapshot
		 * the sidebar already holds: each row carries its `sessionStats`
		 * projection, live for an attached Session and checkpointed for a cold
		 * one. The row's `taskTimer` carries the answer wait that `sessionStats`
		 * billed, so it comes off each row before the sum — subtracting a
		 * conversation-wide total afterwards cannot, since the wait belongs to
		 * one row. Subagent rows are skipped: the conversation that spawned them
		 * already bills their wall time as tool time, so counting both would
		 * double it.
		 * @param state - `sessions.list` snapshot (`ids`, `byId`, `projectionsBySession`).
		 * @returns total milliseconds, 0 before anything is listed.
		 */
		function totalWorkingMs(state) {
			if (state === void 0) return 0;
			const ids = state.ids ?? [];
			const byId = state.byId ?? {};
			const live = state.projectionsBySession ?? {};
			let total = 0;
			for (const id of ids) {
				const row = byId[id];
				if (row === void 0 || row.origin === "subagent") continue;
				const snapshot = live[id]?.values;
				const stats = snapshot?.sessionStats ?? row.projectionValues?.sessionStats;
				if (stats === void 0) continue;
				const awaitMs = (snapshot?.taskTimer ?? row.projectionValues?.taskTimer)?.awaitMs ?? 0;
				total += Math.max(0, stats.llmMs + stats.toolMs - awaitMs);
			}
			return total;
		}

		/**
		 * The sidebar total, injected into `sidebar.footer.action` — the seat the
		 * shell renders directly above the settings/account row.
		 *
		 * It only reads; the conversation pill remains the per-Session number.
		 * The collapsed rail has no room for a caption, so it renders nothing
		 * while `wide` is false.
		 */
		const TotalWorkingTime = memo(function TotalWorkingTime({ wide, useSessions, t }) {
			const totalMs = (useSessions ?? (() => 0))((state) => totalWorkingMs(state));
			if (!wide || !(totalMs > 0)) return null;
			return jsx("div", {
				"data-dsh-task-timer-total": "",
				style: TOTAL_STYLE,
				children: jsx("span", {
					style: TOTAL_TEXT_STYLE,
					children: t("total", { duration: formatDuration(totalMs, t) })
				}, "label")
			}, "total");
		});

		/** Services this client plugin needs on its context. */
		const inject = ["slots", "locale"];

		/**
		 * Register the locale dictionary, mount the pill stylesheet, and mount both
		 * readings: the working-time pill into the conversation composer dock after
		 * the activity and usage pills, and the all-conversation total into the
		 * sidebar foot, directly above the settings/account row.
		 * @param ctx - Client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "task-timer: dictionaries");
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.dshPlugin = "task-timer";
				style.textContent = PILL_CSS;
				document.head.append(style);
				return () => style.remove();
			}, "task-timer: pill styles");
			ctx.slots.inject("conversation.composer.dock", function* () {
				yield ctx.slots.register({
					name: "conversation.composer.dock",
					id: "task-timer",
					order: 2,
					locale: NS
				}, WorkingTimePill);
			});
			ctx.slots.inject("sidebar.footer.action", function* () {
				yield ctx.slots.register({
					name: "sidebar.footer.action",
					id: "task-timer-total",
					order: 0,
					locale: NS
				}, TotalWorkingTime);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
