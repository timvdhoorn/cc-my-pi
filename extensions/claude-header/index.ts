/**
 * Animated startup header (HEADER ONLY) for cc-my-pi.
 *
 * Based on pi-claude-code-tui's `extensions/claude-code-startup.ts`
 * (https://github.com/Phoobobo/pi-claude-code-tui — MIT, Phoobobo).
 *
 * FORKED as of plan 031 — the layout, the π mascot and the right column are
 * original cc-my-pi work; the module no longer tracks upstream and is skipped
 * by `sync-vendored-plugins` (the MIT attribution above stays regardless). What
 * remains of upstream is the box-drawing scaffolding and the setHeader/onTui
 * registration shape.
 *
 * The animation timer runs only to the last frame (self-clearing) and is
 * `unref()`d; `dispose()` clears it on header swap.
 */
import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	center,
	formatCwd,
	formatModelLabel,
	formatThinkingLabel,
	headerColumnWidths,
	padRight,
} from "./render-utils.ts";
import { PI_MASCOT_FRAME_COUNT, piMascotFrame } from "./pi-mascot.ts";
import { collectLoadedStats, resolveAgentDir, type LoadedStats } from "./loaded-stats.ts";

const LOGO_ANIMATION_INTERVAL_MS = 120;

function borderLine(
	left: string,
	label: string,
	right: string,
	width: number,
	paint: (text: string) => string,
): string {
	if (width <= 1) return "";
	if (width < 8 || label.length === 0) {
		return paint(truncateToWidth(left + "─".repeat(Math.max(0, width - 2)) + right, width, ""));
	}

	const before = "─── ";
	const after = " ─────";
	const fixedWidth = visibleWidth(before) + visibleWidth(label) + visibleWidth(after);
	const fill = Math.max(0, width - 2 - fixedWidth);
	return `${paint(left)}${paint(before)}${label}${paint(after)}${paint("─".repeat(fill))}${paint(right)}`;
}

function boxedLine(content: string, width: number, paint: (text: string) => string): string {
	if (width <= 2) return truncateToWidth(content, width, "");
	return `${paint("│")}${padRight(content, width - 2)}${paint("│")}`;
}

function twoColumn(
	left: string,
	right: string,
	leftWidth: number,
	rightWidth: number,
	paint: (text: string) => string,
): string {
	// The wide right column truncates with an ellipsis (Claude Code style); the
	// narrow left column (mascot/model/cwd) is already centered to fit.
	return `${padRight(left, leftWidth)} ${paint("│")} ${padRight(right, rightWidth, "…")}`;
}

class PiStartupHeader implements Component {
	private frame = 0;
	private readonly timer: NodeJS.Timeout;
	private stats: LoadedStats | undefined;
	private readonly hasContextCommand: boolean;
	// Fields written explicitly rather than via constructor parameter properties:
	// cc-my-pi's test harness runs under Node's strip-types (parameter properties
	// are unsupported there).
	private readonly pi: ExtensionAPI;
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;

	constructor(pi: ExtensionAPI, ctx: ExtensionContext, tui: TUI) {
		this.pi = pi;
		this.ctx = ctx;
		this.tui = tui;
		this.hasContextCommand = pi.getCommands().some((c) => c.name === "context");
		const hasMcpAdapter = pi.getCommands().some((c) => c.name === "mcp");

		// Kick off the (shared, cached) resource scan; re-render when it resolves.
		// On failure the header simply omits the count lines.
		collectLoadedStats(ctx.cwd, resolveAgentDir(), hasMcpAdapter)
			.then((stats) => {
				this.stats = stats;
				this.tui.requestRender();
			})
			.catch(() => {
				/* leave stats undefined */
			});

		this.timer = setInterval(() => {
			if (this.frame < PI_MASCOT_FRAME_COUNT - 1) {
				this.frame++;
				this.tui.requestRender();
			} else {
				clearInterval(this.timer);
			}
		}, LOGO_ANIMATION_INTERVAL_MS);
		this.timer.unref?.();
	}

	private rightLines(muted: (s: string) => string, dim: (s: string) => string, accent: (s: string) => string, bold: (s: string) => string, rightWidth: number): string[] {
		const divider = accent("─".repeat(Math.max(8, Math.min(rightWidth, 16))));
		const s = this.stats;

		let countsLine: string;
		let aggregateLine: string;
		if (!s) {
			countsLine = muted("…");
			aggregateLine = "";
		} else {
			const parts = [
				`${s.skills.user + s.skills.project} skills`,
				`${s.prompts.user + s.prompts.project} prompts`,
				`${s.extensions.user + s.extensions.project} extensions`,
			];
			if (s.mcpServers > 0) parts.push(`${s.mcpServers} mcp servers`);
			countsLine = muted(parts.join(" · "));
			// Aggregate spans skills + prompts + extensions (NOT themes, NOT mcp).
			const global = s.skills.user + s.prompts.user + s.extensions.user;
			const project = s.skills.project + s.prompts.project + s.extensions.project;
			aggregateLine = muted(`${global} global · ${project} project`);
		}

		const hints = this.hasContextCommand
			? "/loaded for details · /context to view current context"
			: "/loaded for details";

		return [
			accent(bold("Getting started")),
			muted("Run /cc-my-pi to configure the look"),
			divider,
			accent(bold("Loaded")),
			countsLine,
			aggregateLine,
			dim(hints),
		];
	}

	render(width: number): string[] {
		const theme = this.ctx.ui.theme;
		const paint = (s: string) => theme.fg("accent", s);
		const muted = (s: string) => theme.fg("muted", s);
		const dim = (s: string) => theme.fg("dim", s);
		const bold = (s: string) => theme.bold(s);

		if (width < 24) return [paint(`Pi v${VERSION}`)];

		const innerWidth = width - 2;
		const { leftWidth, rightWidth, useRight } = headerColumnWidths(innerWidth);
		const model = formatModelLabel(this.ctx.model);
		const effort = formatThinkingLabel(this.pi.getThinkingLevel());
		const cwd = formatCwd(this.ctx.cwd);

		// Left column order (Decision 6): tagline → mascot → model·effort → cwd.
		const leftLines = [
			center(bold("cc-my-pi"), leftWidth),
			...piMascotFrame(this.frame, { accent: paint, muted }).map((line) => center(line, leftWidth)),
			center(muted(`${model} · ${effort} effort`), leftWidth),
			center(dim(cwd), leftWidth),
		];

		const rightLines = useRight ? this.rightLines(muted, dim, paint, bold, rightWidth) : [];

		const lines = [borderLine("╭", `${paint("Pi")} v${VERSION}`, "╮", width, paint)];
		const rowCount = Math.max(leftLines.length, rightLines.length);
		for (let i = 0; i < rowCount; i++) {
			const content = useRight
				? twoColumn(leftLines[i] ?? "", rightLines[i] ?? "", leftWidth, rightWidth, paint)
				: padRight(leftLines[i] ?? "", leftWidth);
			lines.push(boxedLine(content, width, paint));
		}
		lines.push(borderLine("╰", "", "╯", width, paint));
		return lines.map((line) => truncateToWidth(line, width, ""));
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.timer);
	}
}

/** Side effects the statusline module runs from its own setHeader factory. */
export type HeaderHooks = { onTui?: (tui: TUI) => void };

let activePiStartupHeader: PiStartupHeader | undefined;

function disposeActiveHeader(): void {
	activePiStartupHeader?.dispose();
	activePiStartupHeader = undefined;
}

function applyPiLook(pi: ExtensionAPI, ctx: ExtensionContext, hooks?: HeaderHooks): void {
	if (ctx.mode !== "tui") return;

	ctx.ui.setHeader((tui) => {
		disposeActiveHeader();
		// Hand the statusline its tui so it keeps activeTui / requestRender /
		// theme-section removal even though it no longer owns the header.
		hooks?.onTui?.(tui);
		activePiStartupHeader = new PiStartupHeader(pi, ctx, tui);
		return activePiStartupHeader;
	});
}

export function registerClaudeHeader(pi: ExtensionAPI, enabled: boolean, hooks?: HeaderHooks): void {
	if (!enabled) return;

	pi.on("session_start", (_event, ctx) => {
		const applyAfterOtherStartupHandlers = setTimeout(() => applyPiLook(pi, ctx, hooks), 0);
		applyAfterOtherStartupHandlers.unref?.();
	});

	pi.on("session_shutdown", () => {
		disposeActiveHeader();
	});
}
