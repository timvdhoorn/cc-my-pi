interface EditorPrototype {
  render(width: number): string[];
  getPaddingX?(): number;
}

export function patchEditorPromptRender(
  EditorClass: { prototype: EditorPrototype },
  patchFlag: symbol,
  decorate: (line: string, paddingX: number, width: number) => string,
): void {
  const proto = EditorClass.prototype;
  const flagged = proto as EditorPrototype & Record<symbol, unknown>;
  if (flagged[patchFlag]) return;
  const originalRender = proto.render;
  proto.render = function patchedEditorPromptRender(width: number): string[] {
    const lines = originalRender.call(this, width);
    if (lines.length >= 3 && width >= 2) {
      lines[1] = decorate(lines[1] ?? "", this.getPaddingX?.() ?? 0, width);
    }
    return lines;
  };
  flagged[patchFlag] = true;
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

export function restoreUserMessageBackground(text: string, background: string, reset: string): string {
  return text
    .replaceAll("\x1b[49m", background)
    .replaceAll(reset, `${reset}${background}`);
}

export function renderClaudeUserMessageLine(options: UserMessageRenderOptions): string {
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
  const prefix = first ? `${chromeColor}❯${reset}${background} ` : "  ";
  const innerWidth = Math.max(1, width - 2);
  const content = clamp(clean(line), innerWidth);
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
  while (start < end && /^(?:❯|›|>)$/.test(stripAnsi(lines[start] ?? "").trim())) {
    start += 1;
  }
  while (start < end && !stripAnsi(lines[start] ?? "").trim()) start += 1;
  return lines.slice(start, end);
}

export function userMessageCopyPayload(plain: string): string {
  return plain.replace(/^❯\s*/, "");
}

export function prefixEditorPromptLine(
  line: string,
  paddingX: number,
  width: number,
  chromeColor: string,
  reset: string,
  truncate: (line: string, width: number, ellipsis: string) => string,
): string {
  const removablePadding = Math.min(
    Math.max(0, paddingX),
    line.match(/^ */)?.[0].length ?? 0,
  );
  const content = line.slice(removablePadding);
  return truncate(`${chromeColor}❯${reset} ${content}`, width, "");
}
