import assert from "node:assert/strict";
import test from "node:test";
import { classifyBashRenderLines, renderClaudeBashLines } from "./bash-execution-render.ts";

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const stripAnsi = (value: string) => value.replace(ANSI, "");
const visibleWidth = (value: string) => [...stripAnsi(value)].length;
const clamp = (value: string, width: number) => [...value].slice(0, width).join("");
const background = "\x1b[48;2;55;55;55m";
const glyphColor = "\x1b[38;2;104;104;104m";
const branchColor = "\x1b[38;5;238m";
const reset = "\x1b[0m";
const transparentReset = `${reset}\x1b[49m`;

function render(command: string, width: number, contentLines: string[]): string[] {
	return renderClaudeBashLines({
		command,
		width,
		contentLines,
		background,
		glyphColor,
		branchColor,
		reset,
		transparentReset,
		clamp,
		visibleWidth,
	});
}

test("splitter drops spacer, both rules, and the header block; keeps output, loader, status in order", () => {
	const lines = [
		"",
		"────────",
		"$ npm test",
		"",
		"output line 1",
		"output line 2",
		"Running... (esc to cancel)",
		"────────",
	];
	assert.deepEqual(classifyBashRenderLines(lines, stripAnsi), [
		"output line 1",
		"output line 2",
		"Running... (esc to cancel)",
	]);
});

test("splitter drops both lines of a wrapped 2-line header block", () => {
	const lines = [
		"",
		"────────",
		"$ some very long command that wraps onto",
		"a second line",
		"",
		"output line 1",
		"────────",
	];
	assert.deepEqual(classifyBashRenderLines(lines, stripAnsi), ["output line 1"]);
});

test("splitter with no output (rules + header only) returns empty content", () => {
	const lines = ["", "────────", "$ ls -la", "────────"];
	assert.deepEqual(classifyBashRenderLines(lines, stripAnsi), []);
});

test("splitter returns null for an unrecognized shape (no header line found)", () => {
	const lines = ["", "────────", "not a header line", "────────"];
	assert.equal(classifyBashRenderLines(lines, stripAnsi), null);
});

test("splitter keeps a trailing loader line that has no blank separator from the header", () => {
	const lines = ["", "────────", "$ npm test", "Running... (esc to cancel)", "────────"];
	assert.deepEqual(classifyBashRenderLines(lines, stripAnsi), ["Running... (esc to cancel)"]);
});

test("band line: background start, bold glyph, padded to width, transparent reset end", () => {
	const [, band] = render("gh auth refresh", 20, []);
	assert.ok(band!.startsWith(background));
	assert.ok(band!.includes("\x1b[1m!\x1b[22m"));
	assert.ok(band!.endsWith(transparentReset));
	assert.equal(visibleWidth(band!), 20);
});

test("output block: first line has the branch arm, continuation lines are 6-space indented, both clamped", () => {
	const lines = render("gh auth refresh", 40, ["First line of output", "Second line of output"]);
	// ["", band, output1, output2]
	assert.equal(lines.length, 4);
	assert.ok(stripAnsi(lines[2]!).includes("⎿"));
	assert.ok(lines[3]!.startsWith("      "));
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 40);
	}
});

test("empty content returns only the spacer and band line, no arm", () => {
	const lines = render("gh auth refresh", 20, []);
	assert.equal(lines.length, 2);
	assert.equal(lines[0], "");
	assert.ok(!stripAnsi(lines[1]!).includes("⎿"));
});
