/**
 * Interactive /cc-my-pi settings overlay with live ASCII previews.
 */
import { getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	SettingsList,
	getKeybindings,
	type SettingItem,
} from "@earendil-works/pi-tui";

export type ToolStyle = "outlines" | "transparent" | "default";
export type BranchPreset = "theme" | "fixed-72" | "fixed-110" | "fixed-40";
export type OutputMode = "hidden" | "summary" | "preview";
export type BashOutputMode = "opencode" | "summary" | "preview";

export interface CcToolsUiSnapshot {
	toolBackground: ToolStyle;
	groupToolCalls: boolean;
	extraToolOutputExpanded: boolean;
	themeAdaptive: boolean;
	liveToolPreview: boolean;
	imagePasterEnabled: boolean;
	escSteerEnabled: boolean;
	doubleEscClearEnabled: boolean;
	queueSteerEnabled: boolean;
	branchPreset: BranchPreset;
	sessionCommandsEnabled: boolean;
	spinnerEnabled: boolean;
	spinnerVerbColor: string;
	spinnerStatusColor: string;
	readOutputMode: OutputMode;
	bashOutputMode: BashOutputMode;
	diffCollapsedLines: number | "stock";
	statuslineCtxStyle: "claude" | "plain";
	statuslineShowWorktree: boolean;
}

export interface CcToolsSettingsController {
	getSnapshot(): CcToolsUiSnapshot;
	/** Apply one setting immediately (persist + live UI). */
	apply(id: keyof CcToolsUiSnapshot | string, value: string, ctx: any): void;
}

const SETTING_ORDER: Array<{
	id: keyof CcToolsUiSnapshot;
	label: string;
	values: string[];
	describe: (snap: CcToolsUiSnapshot) => string;
	current: (snap: CcToolsUiSnapshot) => string;
}> = [
	{
		id: "toolBackground",
		label: "Tool style",
		values: ["outlines", "transparent", "default"],
		current: (s) => s.toolBackground,
		describe: (s) =>
			s.toolBackground === "outlines"
				? "Horizontal rules around each tool body"
				: s.toolBackground === "transparent"
					? "No borders — body is bare indented text"
					: "Rounded box around each tool body (pi default)",
	},
	{
		id: "groupToolCalls",
		label: "Group tools",
		values: ["on", "off"],
		current: (s) => (s.groupToolCalls ? "on" : "off"),
		describe: (s) =>
			s.groupToolCalls
				? "One header + ├/└ glance rows for concurrent tools"
				: "Each tool is a full separate row",
	},
	{
		id: "extraToolOutputExpanded",
		label: "Extra detail",
		values: ["on", "off"],
		current: (s) => (s.extraToolOutputExpanded ? "on" : "off"),
		describe: (s) =>
			s.extraToolOutputExpanded
				? "Ctrl+Shift+O ON — higher expand caps (e.g. 12000 lines)"
				: "Normal expand caps (Ctrl+O); extra-detail off",
	},
	{
		id: "branchPreset",
		label: "Branch color",
		values: ["theme", "fixed-72", "fixed-110", "fixed-40"],
		current: (s) => s.branchPreset,
		describe: (s) =>
			s.branchPreset === "theme"
				? "├ └ │ follow pi theme dim/muted"
				: `├ └ │ fixed gray rgb(${s.branchPreset.replace("fixed-", "")})`,
	},
	{
		id: "diffCollapsedLines",
		label: "Diff preview",
		values: ["stock", "10", "24", "32", "60"],
		current: (s) => String(s.diffCollapsedLines),
		describe: (s) =>
			s.diffCollapsedLines === "stock"
				? "Collapsed diffs use stock caps (24 write / 32 edit)"
				: `Collapsed diffs show at most ${s.diffCollapsedLines} lines`,
	},
	{
		id: "imagePasterEnabled",
		label: "Image paster",
		values: ["on", "off"],
		current: (s) => (s.imagePasterEnabled ? "on" : "off"),
		describe: (s) =>
			s.imagePasterEnabled
				? "Clipboard images and pasted image paths become attachments"
				: "Image attachment paste support disabled (reload required)",
	},
	{
		id: "escSteerEnabled",
		label: "Esc continues queue",
		values: ["on", "off"],
		current: (s) => (s.escSteerEnabled ? "on" : "off"),
		describe: (s) =>
			s.escSteerEnabled
				? "Esc while the agent runs aborts, then auto-sends what was queued"
				: "Esc while running only aborts (no auto-continue)",
	},
	{
		id: "doubleEscClearEnabled",
		label: "Double-Esc clears draft",
		values: ["on", "off"],
		current: (s) => (s.doubleEscClearEnabled ? "on" : "off"),
		describe: (s) =>
			s.doubleEscClearEnabled
				? "Double-Esc on a non-empty idle draft clears it (like Claude Code)"
				: "Double-Esc leaves a non-empty draft untouched",
	},
	{
		id: "queueSteerEnabled",
		label: "Queue steer",
		values: ["on", "off"],
		current: (s) => (s.queueSteerEnabled ? "on" : "off"),
		describe: (s) =>
			s.queueSteerEnabled
				? "Visible steering/follow-up queues with inline editing"
				: "Queue steer disabled — no visible queue widget",
	},
	{
		id: "themeAdaptive",
		label: "Theme adaptive",
		values: ["on", "off"],
		current: (s) => (s.themeAdaptive ? "on" : "off"),
		describe: (s) =>
			s.themeAdaptive
				? "Borders/diffs/muted follow active pi theme"
				: "Fixed Claude palette (ignore pi theme colors)",
	},
	{
		id: "sessionCommandsEnabled",
		label: "Session commands",
		values: ["on", "off"],
		current: (s) => (s.sessionCommandsEnabled ? "on" : "off"),
		describe: (s) =>
			s.sessionCommandsEnabled
				? "/exit (clean shutdown) and /clear (alias for /new); off requires /reload"
				: "/exit and /clear not registered (/reload required)",
	},
	{
		id: "spinnerEnabled",
		label: "Spinner",
		values: ["on", "off"],
		current: (s) => (s.spinnerEnabled ? "on" : "off"),
		describe: (s) =>
			s.spinnerEnabled
				? "Claude-style spinner (verb + status suffix); off requires /reload"
				: "Spinner module disabled (pi default spinner; /reload required)",
	},
	{
		id: "spinnerVerbColor",
		label: "Spinner verb",
		values: ["borderAccent", "accent", "success", "warning", "thinkingHigh", "mdHeading", "muted"],
		current: (s) => s.spinnerVerbColor,
		describe: (s) =>
			s.spinnerVerbColor === "borderAccent"
				? "Verb text (Cooking…) uses borderAccent (default) — more keys/hex: /cc-my-pi spinner"
				: `Verb text (Cooking…) uses ${s.spinnerVerbColor} — more keys/hex: /cc-my-pi spinner`,
	},
	{
		id: "spinnerStatusColor",
		label: "Spinner status",
		values: ["muted", "dim", "text", "borderAccent", "accent"],
		current: (s) => s.spinnerStatusColor,
		describe: (s) =>
			s.spinnerStatusColor === "muted"
				? "Status suffix ((thinking · 2s)) uses muted (default)"
				: `Status suffix ((thinking · 2s)) uses ${s.spinnerStatusColor}`,
	},
	{
		id: "liveToolPreview",
		label: "Live preview",
		values: ["on", "off"],
		current: (s) => (s.liveToolPreview ? "on" : "off"),
		describe: (s) =>
			s.liveToolPreview
				? "While running: show a short output tail under the tool"
				: "While running: header only (no live tail)",
	},
	{
		id: "readOutputMode",
		label: "Read output",
		values: ["preview", "summary", "hidden"],
		current: (s) => s.readOutputMode,
		describe: (s) =>
			s.readOutputMode === "preview"
				? "Collapsed read shows first code lines"
				: s.readOutputMode === "summary"
					? "Collapsed read shows only line count"
					: "Collapsed read hides body entirely",
	},
	{
		id: "bashOutputMode",
		label: "Bash output",
		values: ["opencode", "preview", "summary"],
		current: (s) => s.bashOutputMode,
		describe: (s) =>
			s.bashOutputMode === "opencode"
				? "Rich bash body (summary + sample lines)"
				: s.bashOutputMode === "preview"
					? "Short bash preview (one result line)"
					: "Bash collapsed to exit/status only",
	},
	{
		id: "statuslineCtxStyle",
		label: "Statusline ctx",
		values: ["claude", "plain"],
		current: (s) => s.statuslineCtxStyle,
		describe: (s) =>
			s.statuslineCtxStyle === "claude"
				? "Catppuccin gauge with smooth eighth-block bar"
				: "Theme-colored gauge (pi default)",
	},
	{
		id: "statuslineShowWorktree",
		label: "Statusline wt",
		values: ["on", "off"],
		current: (s) => (s.statuslineShowWorktree ? "on" : "off"),
		describe: (s) =>
			s.statuslineShowWorktree
				? "Show wt <name> when inside a git worktree"
				: "Hide the worktree segment",
	},
];

function boolLabel(on: boolean): string {
	return on ? "on" : "off";
}

/** Visible width ignoring CSI SGR sequences. */
function visibleLen(text: string): number {
	return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padVisible(text: string, width: number): string {
	const len = visibleLen(text);
	if (len >= width) return text;
	return text + " ".repeat(width - len);
}

function safeFg(theme: Theme, key: string, text: string): string {
	try {
		const out = theme.fg(key as any, text);
		if (typeof out === "string" && out.length > 0) return out;
	} catch {
		/* fall through */
	}
	return text;
}

type Paint = {
	muted: (t: string) => string;
	accent: (t: string) => string;
	dim: (t: string) => string;
	title: (t: string) => string;
	ok: (t: string) => string;
	warn: (t: string) => string;
	branch: (t: string) => string;
	rule: (w?: number) => string;
};

function makePaint(theme: Theme, snap: CcToolsUiSnapshot): Paint {
	const muted = (t: string) => safeFg(theme, "muted", t);
	const accent = (t: string) => safeFg(theme, "accent", t);
	const dim = (t: string) => safeFg(theme, "dim", t);
	const title = (t: string) => {
		const bold = typeof theme.bold === "function" ? theme.bold(t) : t;
		return safeFg(theme, "toolTitle", bold);
	};
	const ok = (t: string) => safeFg(theme, "success", t);
	const warn = (t: string) => safeFg(theme, "warning", t);

	// Branch connectors: different visual weight per preset (even when theme keys collapse).
	const branch = (t: string): string => {
		if (snap.branchPreset === "theme") return dim(t);
		if (snap.branchPreset === "fixed-40") return muted(t);
		if (snap.branchPreset === "fixed-110") return accent(t);
		return muted(t); // fixed-72 default
	};

	const ruleChar = snap.themeAdaptive ? "─" : "═";
	const rule = (w = 40) => muted(ruleChar.repeat(Math.max(8, Math.min(w, 42))));

	return { muted, accent, dim, title, ok, warn, branch, rule };
}

function readBodyLines(snap: CcToolsUiSnapshot, p: Paint): string[] {
	if (snap.readOutputMode === "hidden") return [];
	if (snap.readOutputMode === "summary") return [p.muted("14 lines")];
	const lines = [
		p.dim("1  export function login() {"),
		p.dim("2    return token"),
	];
	if (snap.extraToolOutputExpanded) {
		lines.push(p.warn("… extra-detail ON  (expand cap ~12000)"));
	} else {
		lines.push(p.muted("… +12 lines  (ctrl+o expand)"));
	}
	return lines;
}

function bashBodyLines(snap: CcToolsUiSnapshot, p: Paint, opts?: { running?: boolean }): string[] {
	if (opts?.running) {
		// Live-running mock — only meaningful when liveToolPreview is on.
		if (!snap.liveToolPreview) {
			return [p.muted("(running…)  no live tail")];
		}
		return [
			p.muted("PASS auth.test.ts"),
			p.muted("PASS session.test.ts"),
			p.dim("… live tail"),
		];
	}

	if (snap.bashOutputMode === "summary") {
		return [p.muted("exit 0 · 1.2s")];
	}
	if (snap.bashOutputMode === "preview") {
		return [p.ok("✓ 12 passed (1.2s)")];
	}
	// opencode: richer
	return [
		p.ok("✓ 12 passed (1.2s)"),
		p.dim("  tests/auth.test.ts"),
		p.dim("  tests/session.test.ts"),
	];
}

/** Wrap tool body according to toolBackground style. */
function frameBody(snap: CcToolsUiSnapshot, p: Paint, body: string[], indent = ""): string[] {
	if (body.length === 0) return [];
	if (snap.toolBackground === "outlines") {
		// When already under a group branch (`│ `), skip an extra pipe so we don't
		// render `│ │ content`. Bare rows keep the classic │ body gutter.
		const gutter = indent.trim().length > 0 ? "  " : `${p.muted("│")}  `;
		const out = [indent + p.rule(40)];
		for (const line of body) out.push(`${indent}${gutter}${line}`);
		out.push(indent + p.rule(40));
		return out;
	}
	if (snap.toolBackground === "default") {
		const inner = 34;
		const out = [indent + p.muted("╭" + "─".repeat(inner + 2) + "╮")];
		for (const line of body) {
			out.push(`${indent}${p.muted("│")} ${padVisible(line, inner)} ${p.muted("│")}`);
		}
		out.push(indent + p.muted("╰" + "─".repeat(inner + 2) + "╯"));
		return out;
	}
	// transparent
	return body.map((line) => `${indent}  ${line}`);
}

function paintStandaloneTool(
	lines: string[],
	snap: CcToolsUiSnapshot,
	p: Paint,
	name: string,
	summary: string,
	body: string[],
): void {
	lines.push(`${p.ok("●")} ${p.title(name)}  ${p.accent(summary)}`);
	lines.push(...frameBody(snap, p, body));
}

function paintGrouped(lines: string[], snap: CcToolsUiSnapshot, p: Paint): void {
	const b = p.branch;
	lines.push(`${p.accent("◐")} ${p.title("2 tools")} ${p.muted("· 0.8s")}`);

	// Read glance + optional body under tee
	lines.push(`${b("├")} ${p.ok("●")} ${p.title("Read")}  ${p.accent("src/auth.ts")}`);
	const readBody = readBodyLines(snap, p);
	if (readBody.length > 0) {
		// In grouped mode, body hangs under the branch with the same tool chrome.
		const framed = frameBody(snap, p, readBody, `${b("│")} `);
		lines.push(...framed);
	}

	// Bash glance
	lines.push(`${b("└")} ${p.ok("●")} ${p.title("Bash")}  ${p.accent("npm test")}`);

	// Finished bash body (aligned under corner — use spaces matching "└ ")
	const bashFinished = bashBodyLines(snap, p);
	if (bashFinished.length > 0) {
		lines.push(...frameBody(snap, p, bashFinished, "  "));
	}

	// Optional second mock: running bash with live preview difference
	if (snap.liveToolPreview) {
		lines.push("");
		lines.push(p.dim("while running:"));
		lines.push(`${p.warn("●")} ${p.title("Bash")}  ${p.accent("npm test")} ${p.muted("(in flight)")}`);
		lines.push(...frameBody(snap, p, bashBodyLines(snap, p, { running: true }), "  "));
	}
}

function paintUngrouped(lines: string[], snap: CcToolsUiSnapshot, p: Paint): void {
	paintStandaloneTool(lines, snap, p, "Read", "src/auth.ts", readBodyLines(snap, p));
	lines.push("");
	paintStandaloneTool(lines, snap, p, "Bash", "npm test", bashBodyLines(snap, p));

	if (snap.liveToolPreview) {
		lines.push("");
		lines.push(p.dim("while running:"));
		paintStandaloneTool(
			lines,
			snap,
			p,
			"Bash",
			"npm test",
			bashBodyLines(snap, p, { running: true }),
		);
	}
}

/** ASCII mock of the tool chrome for the current snapshot. */
export function buildCcToolsPreview(snap: CcToolsUiSnapshot, theme: Theme, focusId?: string): string[] {
	const p = makePaint(theme, snap);
	const lines: string[] = [];

	lines.push(p.muted("Preview — updates when you cycle a value"));
	if (focusId) {
		const focused = SETTING_ORDER.find((s) => s.id === focusId);
		if (focused) {
			lines.push(p.accent(`changed: ${focused.label} → ${focused.current(snap)}`));
			lines.push(p.dim(focused.describe(snap)));
		}
	}
	lines.push("");

	if (snap.groupToolCalls) paintGrouped(lines, snap, p);
	else paintUngrouped(lines, snap, p);

	lines.push("");
	lines.push(p.title("Assistant list"));
	lines.push("  - first item");
	lines.push("  - second item");

	lines.push("");
	// Footer chips — always reflect every setting so nothing is "invisible".
	const chips = [
		`style=${snap.toolBackground}`,
		`group=${boolLabel(snap.groupToolCalls)}`,
		`detail=${boolLabel(snap.extraToolOutputExpanded)}`,
		`branch=${snap.branchPreset}`,
		`diff=${snap.diffCollapsedLines}`,
		`theme=${boolLabel(snap.themeAdaptive)}`,
		`live=${boolLabel(snap.liveToolPreview)}`,
		`read=${snap.readOutputMode}`,
		`bash=${snap.bashOutputMode}`,
		`sline=${snap.statuslineCtxStyle}`,
		`wt=${boolLabel(snap.statuslineShowWorktree)}`,
	];
	lines.push(p.dim(chips.join(" · ")));

	// Theme-adaptive visual cue: different rule style already; call it out.
	lines.push(
		p.dim(
			snap.themeAdaptive
				? "rules use ─ (theme-adaptive chrome)"
				: "rules use ═ (fixed Claude chrome)",
		),
	);

	return lines;
}

function toSettingItems(snap: CcToolsUiSnapshot): SettingItem[] {
	return SETTING_ORDER.map((def) => ({
		id: def.id,
		label: def.label,
		currentValue: def.current(snap),
		values: [...def.values],
		description: def.describe(snap),
	}));
}

type PanelComponent = {
	render: (width: number) => string[];
	invalidate: () => void;
	handleInput: (data: string) => void;
};

/**
 * Open the interactive settings overlay. Resolves when the user closes it.
 */
export async function openCcToolsSettingsPanel(
	ctx: any,
	controller: CcToolsSettingsController,
): Promise<void> {
	if (!ctx?.hasUI) {
		ctx?.ui?.notify?.("/cc-my-pi UI requires TUI mode", "error");
		return;
	}

	await ctx.ui.custom(
		(_tui: unknown, theme: Theme, _kb: unknown, done: (value?: undefined) => void) => {
			let snap = controller.getSnapshot();
			let lastChangedId: string | undefined;
			// Stable item objects so SettingsList keeps selection across value changes.
			const items = toSettingItems(snap);
			let cacheWidth: number | undefined;
			let cacheLines: string[] | undefined;

			const refreshItemMeta = () => {
				for (const def of SETTING_ORDER) {
					const item = items.find((i) => i.id === def.id);
					if (!item) continue;
					item.currentValue = def.current(snap);
					item.description = def.describe(snap);
					item.values = [...def.values];
				}
			};

			const applyValue = (id: string, newValue: string) => {
				controller.apply(id, newValue, ctx);
				snap = controller.getSnapshot();
				lastChangedId = id;
				refreshItemMeta();
				// Keep SettingsList's internal currentValue in sync (same object refs,
				// but updateValue is the public API and is cheap).
				list.updateValue(id, newValue);
				cacheWidth = undefined;
				cacheLines = undefined;
				ctx.ui.requestRender?.();
			};

			const cycleSelected = (direction: 1 | -1): boolean => {
				const listAny = list as any;
				const displayItems: SettingItem[] = listAny.searchEnabled
					? (listAny.filteredItems as SettingItem[])
					: items;
				if (!displayItems.length) return false;
				const idx = Math.max(0, Math.min(Number(listAny.selectedIndex) || 0, displayItems.length - 1));
				const item = displayItems[idx];
				if (!item?.values?.length) return false;
				const cur = item.values.indexOf(item.currentValue);
				const base = cur >= 0 ? cur : 0;
				const next = (base + direction + item.values.length) % item.values.length;
				const newValue = item.values[next]!;
				item.currentValue = newValue;
				applyValue(item.id, newValue);
				// Restore selection in case anything touched it.
				listAny.selectedIndex = idx;
				return true;
			};

			const list = new SettingsList(
				items,
				Math.min(SETTING_ORDER.length + 2, 12),
				getSettingsListTheme(),
				(id, newValue) => {
					// Enter/Space path from SettingsList — do not recreate the list.
					applyValue(id, newValue);
					// Selection stays put because we never replace SettingsList.
				},
				() => done(undefined),
				{ enableSearch: true },
			);

			const kb = getKeybindings();

			const panel: PanelComponent = {
				invalidate() {
					cacheWidth = undefined;
					cacheLines = undefined;
					list.invalidate();
				},
				handleInput(data: string) {
					// Left/right cycle the focused setting without moving selection.
					if (kb.matches(data, "tui.editor.cursorLeft") || data === "h") {
						if (cycleSelected(-1)) return;
					}
					if (kb.matches(data, "tui.editor.cursorRight") || data === "l") {
						if (cycleSelected(1)) return;
					}
					list.handleInput(data);
					cacheWidth = undefined;
					cacheLines = undefined;
				},
				render(width: number) {
					if (cacheLines && cacheWidth === width) return cacheLines;

					const header = [
						safeFg(theme, "accent", theme.bold?.("cc-my-pi settings") ?? "cc-my-pi settings") +
							safeFg(
								theme,
								"muted",
								"  ←/→ or enter/space cycle · esc close · type to search",
							),
						"",
					];
					const listLines = list.render(width);
					const gap = [""];
					const hint = [
						safeFg(
							theme,
							"dim",
							"Changes apply live. Preview below mirrors the current combination.",
						),
						"",
					];
					const previewLines = buildCcToolsPreview(snap, theme, lastChangedId);

					const out = [...header, ...listLines, ...gap, ...hint, ...previewLines];
					cacheWidth = width;
					cacheLines = out;
					return out;
				},
			};

			return panel;
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "bottom-center",
				width: "100%",
				maxHeight: "90%",
				margin: { left: 0, right: 0, bottom: 0 },
			},
		},
	);
}

/**
 * Guided first-run walkthrough: the settings overlay restricted to one row at a
 * time, in SETTING_ORDER order. Each step applies changes live through the same
 * controller as the panel and shows buildCcToolsPreview with the current row
 * focused, so every change renders its `changed: <label> → <value>` example.
 * Resolves when the user finishes (Esc or Enter on the last step). The caller
 * owns the "setup done" marker — this component stays settings-file-agnostic.
 */
export async function openCcToolsSetupWizard(
	ctx: any,
	controller: CcToolsSettingsController,
): Promise<void> {
	if (!ctx?.hasUI) {
		ctx?.ui?.notify?.("/cc-my-pi setup requires TUI mode", "error");
		return;
	}

	await ctx.ui.custom(
		(_tui: unknown, theme: Theme, _kb: unknown, done: (value?: undefined) => void) => {
			let snap = controller.getSnapshot();
			let stepIndex = 0;
			const total = SETTING_ORDER.length;
			let cacheWidth: number | undefined;
			let cacheLines: string[] | undefined;
			const kb = getKeybindings();

			const invalidateCache = () => {
				cacheWidth = undefined;
				cacheLines = undefined;
			};

			const cycle = (direction: 1 | -1) => {
				const def = SETTING_ORDER[stepIndex];
				if (!def?.values.length) return;
				const cur = def.current(snap);
				const idx = def.values.indexOf(cur);
				const base = idx >= 0 ? idx : 0;
				const next = def.values[(base + direction + def.values.length) % def.values.length]!;
				controller.apply(def.id, next, ctx);
				snap = controller.getSnapshot();
				invalidateCache();
				ctx.ui.requestRender?.();
			};

			const advance = () => {
				if (stepIndex >= total - 1) {
					done(undefined);
					return;
				}
				stepIndex += 1;
				invalidateCache();
				ctx.ui.requestRender?.();
			};

			const back = () => {
				if (stepIndex <= 0) return;
				stepIndex -= 1;
				invalidateCache();
				ctx.ui.requestRender?.();
			};

			return {
				invalidate() {
					invalidateCache();
				},
				handleInput(data: string) {
					if (kb.matches(data, "tui.editor.cursorLeft") || data === "h") return cycle(-1);
					if (kb.matches(data, "tui.editor.cursorRight") || data === "l" || data === " ") return cycle(1);
					if (data === "\r" || data === "\n") return advance();
					if (data === "b") return back();
					if (data === "\x1b") return done(undefined);
				},
				render(width: number) {
					if (cacheLines && cacheWidth === width) return cacheLines;
					const def = SETTING_ORDER[stepIndex]!;
					const titleText = `cc-my-pi setup — step ${stepIndex + 1}/${total}: ${def.label}`;
					const title = safeFg(theme, "accent", theme.bold?.(titleText) ?? titleText);
					const hints = safeFg(theme, "muted", "←/→ or space change · enter next · b back · esc finish");
					const cur = def.current(snap);
					const valueLine = def.values
						.map((v) => (v === cur ? safeFg(theme, "accent", `● ${v}`) : safeFg(theme, "dim", `  ${v}`)))
						.join("   ");
					const describe = safeFg(theme, "dim", def.describe(snap));
					const preview = buildCcToolsPreview(snap, theme, def.id);
					const out = [title, hints, "", valueLine, describe, "", ...preview];
					cacheWidth = width;
					cacheLines = out;
					return out;
				},
			};
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "bottom-center",
				width: "100%",
				maxHeight: "90%",
				margin: { left: 0, right: 0, bottom: 0 },
			},
		},
	);
}
