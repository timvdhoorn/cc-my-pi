import { restoreUserMessageBackground } from "./user-message-render.ts";

/**
 * Strips pi-core's `BashExecutionComponent` frame (spacer, top/bottom `─` rules,
 * `$ command` header block) from its rendered lines, leaving only the content
 * that belongs under the Claude-style result arm (output, loader, status).
 *
 * The header block is "the first content line (matching `$ `) through the next
 * blank line" — this also swallows a wrapped multi-line header, since wrapped
 * continuation lines sit between the header start and that same blank line.
 * When no blank line follows the header at all (e.g. a running command with no
 * output yet, where the loader trails the header with no separator), only the
 * single header line is dropped so the loader line survives as content.
 *
 * Returns `null` if the first non-blank, non-rule line does not look like a
 * header (`$ ...`) — callers should treat that as "unrecognized shape" and
 * fall back to the original render. An empty array (as opposed to `null`)
 * means the header was found but there is no output/loader/status content.
 */
export function classifyBashRenderLines(
	lines: string[],
	stripAnsi: (line: string) => string,
): string[] | null {
	const isBlank = (line: string) => stripAnsi(line).trim() === "";
	const isRule = (line: string) => /^─+$/.test(stripAnsi(line).trim());

	let start = 0;
	let end = lines.length;
	while (start < end && isBlank(lines[start]!)) start += 1;
	while (end > start && isBlank(lines[end - 1]!)) end -= 1;
	if (start < end && isRule(lines[start]!)) start += 1;
	if (end > start && isRule(lines[end - 1]!)) end -= 1;
	while (start < end && isBlank(lines[start]!)) start += 1;
	while (end > start && isBlank(lines[end - 1]!)) end -= 1;

	if (start >= end) return [];
	if (!stripAnsi(lines[start]!).trim().startsWith("$ ")) return null;

	let blankIndex = -1;
	for (let i = start + 1; i < end; i++) {
		if (isBlank(lines[i]!)) {
			blankIndex = i;
			break;
		}
	}
	const contentStart = blankIndex === -1 ? start + 1 : blankIndex + 1;
	return lines.slice(contentStart, end);
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
