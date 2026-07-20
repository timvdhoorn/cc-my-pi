import assert from "node:assert/strict";
import test from "node:test";
import {
  patchEditorPromptRender,
  prefixEditorPromptLine,
  renderClaudeUserMessageLine,
  restoreUserMessageBackground,
  stripAttachedImagePathsBlock,
  trimUserMessagePadding,
  userMessageCopyPayload,
} from "./user-message-render.ts";

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const stripAnsi = (value: string) => value.replace(ANSI, "");
const visibleWidth = (value: string) => [...stripAnsi(value)].length;
const background = "\x1b[48;2;55;55;55m";
const reset = "\x1b[0m";

function render(line: string, width: number, first: boolean): string {
  return renderClaudeUserMessageLine({
    line,
    width,
    first,
    background,
    chromeColor: "\x1b[38;2;104;104;104m",
    reset,
    transparentReset: `${reset}\x1b[49m`,
    clean: (value) => value.trim(),
    clamp: (value, limit) => [...value].slice(0, limit).join(""),
    visibleWidth,
  });
}

test("renders a compact single-line Claude user message", () => {
  const plain = stripAnsi(render("hello", 20, true));
  assert.equal([...plain].length, 20);
  assert.match(plain, /^❯ hello\s+$/);
  assert.doesNotMatch(plain, /User|[╭╮╰╯│]/);
});

test("uses the chevron only on the first multiline row", () => {
  const lines = ["first", "second"].map((line, index) =>
    stripAnsi(render(line, 20, index === 0)),
  );
  assert.match(lines[0]!, /^❯ first/);
  assert.match(lines[1]!, /^  second/);
  assert.doesNotMatch(lines[1]!, /❯/);
});

test("removes native prompt row and control-only vertical padding", () => {
  const osc = "\x1b]133;A\x07";
  const cleanTerminalLine = (line: string) =>
    stripAnsi(line).replace(/\x1b\][^\x07]*(?:\x07|$)/g, "");
  assert.deepEqual(
    trimUserMessagePadding([osc, "❯", "hello", "world", ""], cleanTerminalLine),
    ["hello", "world"],
  );
});

test("restores row background after embedded resets", () => {
  const restored = restoreUserMessageBackground(
    `before${reset}after\x1b[49mend`,
    background,
    reset,
  );
  assert.ok(restored.includes(`${reset}${background}after`));
  assert.ok(restored.endsWith(`${background}end`));
});

test("copy payload excludes the visual chevron", () => {
  assert.equal(userMessageCopyPayload("❯ hello"), "hello");
});

test("decorates editor subclasses without replacing image-paste behavior", () => {
  class Editor {
    render(_width: number): string[] {
      return ["────", " text", "────"];
    }
    getPaddingX(): number {
      return 1;
    }
  }
  class ImagePasterEditor extends Editor {
    imagePaste(): string {
      return "attached";
    }
  }
  const flag = Symbol("prompt-render-test");
  patchEditorPromptRender(Editor, flag, (line, paddingX) =>
    prefixEditorPromptLine(line, paddingX, 16, "", "", (value) => value),
  );

  const editor = new ImagePasterEditor();
  assert.equal(editor.imagePaste(), "attached");
  assert.match(editor.render(16)[1]!, /^❯ text/);
});

test("adds a Claude chevron to the live editor row", () => {
  const line = prefixEditorPromptLine(
    " text             ",
    1,
    16,
    "\x1b[38;2;104;104;104m",
    reset,
    (value) => value,
  );
  assert.match(stripAnsi(line), /^❯ text/);
});

const bashColor = "\x1b[38;2;200;150;50m";

test("bash-mode draft with bashColor shows the ! glyph, drops the typed !, keeps the rest", () => {
  const line = prefixEditorPromptLine(
    "!ip a",
    0,
    16,
    "\x1b[38;2;104;104;104m",
    reset,
    (value) => value,
    bashColor,
  );
  assert.ok(line.includes(`${bashColor}!${reset}`));
  assert.match(stripAnsi(line), /^! ip a/);
  assert.equal((stripAnsi(line).match(/!/g) ?? []).length, 1);
});

test("bash-mode draft without bashColor keeps the old chevron behavior", () => {
  const line = prefixEditorPromptLine(
    "!ip a",
    0,
    16,
    "\x1b[38;2;104;104;104m",
    reset,
    (value) => value,
  );
  assert.match(stripAnsi(line), /^❯ !ip a/);
});

test("normal draft with bashColor still uses the chevron path", () => {
  const line = prefixEditorPromptLine(
    "hello",
    0,
    16,
    "\x1b[38;2;104;104;104m",
    reset,
    (value) => value,
    bashColor,
  );
  assert.match(stripAnsi(line), /^❯ hello/);
});

test("draft !!cmd shows a single ! glyph, remaining content starts with !cmd", () => {
  const line = prefixEditorPromptLine(
    "!!cmd",
    0,
    16,
    "\x1b[38;2;104;104;104m",
    reset,
    (value) => value,
    bashColor,
  );
  const plain = stripAnsi(line);
  assert.match(plain, /^! !cmd/);
});

test("ANSI codes before the leading ! are preserved after stripping it", () => {
  const cursorStyle = "\x1b[7m";
  const line = prefixEditorPromptLine(
    `${cursorStyle}!ip a`,
    0,
    16,
    "\x1b[38;2;104;104;104m",
    reset,
    (value) => value,
    bashColor,
  );
  assert.ok(line.startsWith(`${cursorStyle}${bashColor}!`));
});

test("strips a trailing attached-image-paths block from display", () => {
  const lines = [
    "dit is een test [#image 1] kun je testen",
    "",
    "Attached image paths:",
    "- [#image 1]: /Users/tim/Library/Screenshot 2026-07-19 at 22.05.40@2x.png",
  ];
  assert.deepEqual(stripAttachedImagePathsBlock(lines, stripAnsi), [
    "dit is een test [#image 1] kun je testen",
  ]);
});

test("keeps an attached-image-paths block followed by other content", () => {
  const lines = [
    "Attached image paths:",
    "- [#image 1]: /tmp/a.png",
    "meer tekst erna",
  ];
  assert.deepEqual(stripAttachedImagePathsBlock(lines, stripAnsi), lines);
});

test("leaves messages without an attachment block untouched", () => {
  const lines = ["gewoon een bericht", "tweede regel"];
  assert.deepEqual(stripAttachedImagePathsBlock(lines, stripAnsi), lines);
});
