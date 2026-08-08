interface EditorPrototype {
	render(width: number): string[];
	getPaddingX?(): number;
}

export function patchEditorPromptRender(
	EditorClass: { prototype: EditorPrototype },
	patchFlag: symbol,
	decorate: (line: string, paddingX: number, width: number) => string,
	decorateContinuation: (
		line: string,
		paddingX: number,
		width: number,
	) => string = indentEditorContinuationLine,
): void {
	const proto = EditorClass.prototype;
	const flagged = proto as EditorPrototype & Record<symbol, unknown>;
	if (flagged[patchFlag]) return;
	const originalRender = proto.render;
	proto.render = function patchedEditorPromptRender(width: number): string[] {
		const lines = originalRender.call(this, width);
		if (lines.length >= 3 && width >= 2) {
			const paddingX = this.getPaddingX?.() ?? 0;
			lines[1] = decorate(lines[1] ?? "", paddingX, width);
			for (let index = 2; index < lines.length - 1; index++) {
				lines[index] = decorateContinuation(
					lines[index] ?? "",
					paddingX,
					width,
				);
			}
		}
		return lines;
	};
	flagged[patchFlag] = true;
}

export function indentEditorContinuationLine(
	line: string,
	paddingX: number,
	width: number,
	truncate: (line: string, width: number, ellipsis: string) => string = (
		value,
		limit,
	) => value.slice(0, limit),
): string {
	const removablePadding = Math.min(
		Math.max(0, paddingX),
		line.match(/^ */)?.[0].length ?? 0,
	);
	return truncate(`  ${line.slice(removablePadding)}`, Math.max(0, width), "");
}

export interface UserMessageRenderOptions {
	line: string;
	width: number;
	first: boolean;
	background: string;
	chromeColor: string;
	reset: string;
	transparentReset: string;
	clean: (line: string) => string;
	clamp: (line: string, width: number) => string;
	visibleWidth: (line: string) => number;
}

export function restoreUserMessageBackground(
	text: string,
	background: string,
	reset: string,
): string {
	return text
		.replaceAll("\x1b[49m", background)
		.replaceAll(reset, `${reset}${background}`);
}

export function renderClaudeUserMessageLine(
	options: UserMessageRenderOptions,
): string {
	const {
		line,
		width,
		first,
		background,
		chromeColor,
		reset,
		transparentReset,
		clean,
		clamp,
		visibleWidth,
	} = options;
	let cleaned = clean(line);
	const contextContinuation =
		!first && cleaned.startsWith(CONTEXT_CONTINUATION_MARK);
	if (contextContinuation)
		cleaned = cleaned.slice(CONTEXT_CONTINUATION_MARK.length);
	let prefix = "  ";
	if (first) prefix = `${chromeColor}❯${reset}${background} `;
	else if (contextContinuation) prefix = "     ";
	const innerWidth = Math.max(1, width - (contextContinuation ? 5 : 2));
	const content = clamp(cleaned, innerWidth);
	const body = `${prefix}${restoreUserMessageBackground(content, background, reset)}`;
	const padding = " ".repeat(Math.max(0, width - visibleWidth(body)));
	return `${background}${body}${padding}${transparentReset}`;
}

export function trimUserMessagePadding(
	lines: string[],
	stripAnsi: (line: string) => string,
): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && !stripAnsi(lines[start] ?? "").trim()) start += 1;
	while (end > start && !stripAnsi(lines[end - 1] ?? "").trim()) end -= 1;
	while (
		start < end &&
		/^(?:❯|›|>)$/.test(stripAnsi(lines[start] ?? "").trim())
	) {
		start += 1;
	}
	while (start < end && !stripAnsi(lines[start] ?? "").trim()) start += 1;
	return lines.slice(start, end);
}

const CONTEXT_CONTINUATION_MARK = "\uE000";
const CONTEXT_BRANCH =
	/^((?:\x1b\[[0-?]*[ -/]*[@-~]|\s)*)([├└│⎿])(?:─)?((?:\x1b\[[0-?]*[ -/]*[@-~])*)\s*/;

/** Collapse Pi's attachment/context tree into one Claude-style result arm. */
export function normalizeClaudeUserContextBranches(lines: string[]): string[] {
	let armSeen = false;
	return lines.map((line, index) => {
		if (index === 0 || !CONTEXT_BRANCH.test(line)) return line;
		if (armSeen) {
			return line.replace(CONTEXT_BRANCH, `${CONTEXT_CONTINUATION_MARK}$1$3`);
		}
		armSeen = true;
		return line.replace(CONTEXT_BRANCH, "$1⎿$3  ");
	});
}

/**
 * Display-only removal of pi-paster's appended attachment block:
 *
 *   Attached image paths:
 *   - [#image 1]: /path/to/img.png
 *
 * The block stays in the actual message content (the model needs the paths);
 * pi-paster already renders its own "Attached [#image 1] <path>" preview under
 * the message, so showing the block inside the box duplicates it. Only strips
 * when the block is the tail of the message and every line after the header is
 * an attachment bullet.
 */
export function stripAttachedImagePathsBlock(
	lines: string[],
	stripAnsi: (line: string) => string,
): string[] {
	const plain = lines.map((line) => stripAnsi(line).trim());
	let header = -1;
	for (let i = plain.length - 1; i >= 0; i--) {
		if (plain[i] === "Attached image paths:") {
			header = i;
			break;
		}
	}
	if (header === -1) return lines;
	for (let i = header + 1; i < plain.length; i++) {
		if (plain[i] === "") continue;
		if (!/^-\s*\[#image \d+\]:\s/.test(plain[i]!)) return lines;
	}
	let end = header;
	while (end > 0 && plain[end - 1] === "") end -= 1;
	return lines.slice(0, end);
}

export function userMessageCopyPayload(plain: string): string {
	return plain.replace(/^❯\s*/, "");
}

const LEADING_BASH_BANG = /^((?:\x1b\[[0-9;]*m)*)!/;

export function prefixEditorPromptLine(
	line: string,
	paddingX: number,
	width: number,
	chromeColor: string,
	reset: string,
	truncate: (line: string, width: number, ellipsis: string) => string,
	bashColor?: string,
): string {
	const removablePadding = Math.min(
		Math.max(0, paddingX),
		line.match(/^ */)?.[0].length ?? 0,
	);
	const content = line.slice(removablePadding);
	if (bashColor) {
		const bangMatch = content.match(LEADING_BASH_BANG);
		if (bangMatch) {
			// Drop the typed `!` itself, keep any ANSI codes that preceded it (e.g.
			// the cursor's inverse styling), so a bash-mode draft renders with the
			// `!` glyph in place of the typed character rather than duplicating it.
			// Known cosmetic edge: with the cursor ON the leading `!`, the cursor's
			// inverse styling for that one character is dropped for this frame.
			const rest = content.slice(bangMatch[0].length);
			return truncate(
				`${bangMatch[1]}${bashColor}!${reset} ${rest}`,
				width,
				"",
			);
		}
	}
	return truncate(`${chromeColor}❯${reset} ${content}`, width, "");
}
