import { restoreUserMessageBackground } from "./user-message-render.ts";

export interface BashContentOptions {
	outputLines: string[]; // component's raw lines (plain text)
	status: string; // "running" | "complete" | "error" | "cancelled"
	exitCode: number | undefined;
	truncated: boolean;
	fullOutputPath: string | undefined;
	loaderLines: string[]; // pre-rendered loader lines while running, else []
	innerWidth: number; // width available for content (width - 6)
	runningTailLimit: number; // cap while streaming (use 20)
	wrap: (line: string, width: number) => string[];
	styleOutput: (line: string) => string; // muted
	styleError: (line: string) => string;
	styleWarning: (line: string) => string;
}

/**
 * Builds the `⎿`-arm content lines directly from the `BashExecutionComponent`
 * instance's own state, instead of parsing pi-core's rendered output. pi-core's
 * render layout is not stable enough to splice apart reliably (the header and
 * output are not always separated by a blank line), so this reads the source
 * of truth (`outputLines`, `status`, `exitCode`, ...) and re-derives the
 * content block that used to be scraped from rendered text.
 *
 * Claude Code parity: shows the FULL output once a command finishes (no
 * "... N more lines" collapse) — only the `status === "running"` case caps to
 * `runningTailLimit` wrapped lines, to keep the live streaming preview cheap.
 */
export function buildBashContentLines(opts: BashContentOptions): string[] {
	const {
		outputLines,
		status,
		exitCode,
		truncated,
		fullOutputPath,
		loaderLines,
		innerWidth,
		runningTailLimit,
		wrap,
		styleOutput,
		styleError,
		styleWarning,
	} = opts;

	let start = 0;
	let end = outputLines.length;
	while (start < end && outputLines[start]!.trim() === "") start += 1;
	while (end > start && outputLines[end - 1]!.trim() === "") end -= 1;

	const wrapped: string[] = [];
	for (let i = start; i < end; i++) {
		for (const wrappedLine of wrap(outputLines[i]!, innerWidth)) {
			wrapped.push(styleOutput(wrappedLine));
		}
	}

	if (status === "running") {
		const tail = opts.runningTailLimit > 0 ? wrapped.slice(-runningTailLimit) : wrapped;
		// pi-tui's Loader.render() prefixes its output with a blank line
		// (`["", ...spinnerLine]`); drop leading blank entries so an empty
		// output block doesn't leave the `⎿` arm pointing at a blank line.
		const loader = [...loaderLines];
		while (loader.length > 0 && loader[0]!.replace(/\x1b\[[0-9;]*m/g, "").trim() === "") {
			loader.shift();
		}
		return [...tail, ...loader];
	}

	const content = [...wrapped];
	if (status === "cancelled") {
		content.push(styleWarning("(cancelled)"));
	} else if (status === "error") {
		content.push(styleError(`(exit ${exitCode})`));
	}
	if (truncated && fullOutputPath) {
		content.push(styleWarning(`Output truncated. Full output: ${fullOutputPath}`));
	}
	return content;
}

export interface BashRenderOptions {
	command: string;
	width: number;
	contentLines: string[];
	background: string;
	glyphColor: string;
	branchColor: string;
	reset: string;
	transparentReset: string;
	clamp: (line: string, width: number) => string;
	visibleWidth: (line: string) => number;
}

function renderBandLine(opts: BashRenderOptions): string {
	const { command, width, background, glyphColor, reset, transparentReset, clamp, visibleWidth } = opts;
	const prefix = `${glyphColor}\x1b[1m!\x1b[22m${reset}${background} `;
	const innerWidth = Math.max(1, width - 2);
	const content = clamp(command, innerWidth);
	const body = `${prefix}${restoreUserMessageBackground(content, background, reset)}`;
	const padding = " ".repeat(Math.max(0, width - visibleWidth(body)));
	return `${background}${body}${padding}${transparentReset}`;
}

function renderOutputLines(opts: BashRenderOptions): string[] {
	const { contentLines, branchColor, transparentReset, width, clamp } = opts;
	return contentLines.map((line, index) => {
		const prefix = index === 0 ? `   ${branchColor}⎿${transparentReset}  ` : "      ";
		return clamp(`${prefix}${line}`, width);
	});
}

/**
 * Builds the final Claude-style bash-mode row: a blank spacer, the full-width
 * `!` band, and the output/loader/status block indented under a `⎿` arm.
 */
export function renderClaudeBashLines(opts: BashRenderOptions): string[] {
	const bandLine = renderBandLine(opts);
	if (opts.contentLines.length === 0) return ["", bandLine];
	return ["", bandLine, ...renderOutputLines(opts)];
}
