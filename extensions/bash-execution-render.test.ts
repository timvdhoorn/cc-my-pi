import assert from "node:assert/strict";
import test from "node:test";
import { buildBashContentLines, renderClaudeBashLines } from "./bash-execution-render.ts";

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

// Plain stubs for buildBashContentLines: `wrap` hard-splits at width, style
// functions are identity-ish (tag the string so assertions can see which
// style was applied without needing real ANSI codes).
const wrap = (line: string, width: number): string[] => {
	if (width <= 0 || line.length <= width) return [line];
	const parts: string[] = [];
	for (let i = 0; i < line.length; i += width) parts.push(line.slice(i, i + width));
	return parts;
};
const styleOutput = (line: string) => `OUT:${line}`;
const styleError = (line: string) => `ERR:${line}`;
const styleWarning = (line: string) => `WARN:${line}`;

function buildContent(overrides: Partial<Parameters<typeof buildBashContentLines>[0]> = {}) {
	return buildBashContentLines({
		outputLines: [],
		status: "complete",
		exitCode: undefined,
		truncated: false,
		fullOutputPath: undefined,
		loaderLines: [],
		innerWidth: 80,
		runningTailLimit: 20,
		wrap,
		styleOutput,
		styleError,
		styleWarning,
		...overrides,
	});
}

test("full output shown when complete (no tail cap): 30 in -> 30 out, in order", () => {
	const outputLines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
	const result = buildContent({ outputLines, status: "complete" });
	assert.equal(result.length, 30);
	assert.deepEqual(result, outputLines.map(styleOutput));
});

test("running: tail cap applies (30 in, limit 20 -> last 20) + loader lines appended", () => {
	const outputLines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
	const result = buildContent({
		outputLines,
		status: "running",
		runningTailLimit: 20,
		loaderLines: ["spinner"],
	});
	assert.equal(result.length, 21);
	assert.deepEqual(result.slice(0, 20), outputLines.slice(-20).map(styleOutput));
	assert.equal(result[20], "spinner");
});

test("running: leading blank loader line (pi-tui Loader.render() shape) is dropped, no blank line before the arm", () => {
	const result = buildContent({
		outputLines: [],
		status: "running",
		loaderLines: ["", "Running..."],
	});
	assert.deepEqual(result, ["Running..."]);
});

test("error appends (exit 1) styled via styleError", () => {
	const result = buildContent({ outputLines: ["ok"], status: "error", exitCode: 1 });
	assert.deepEqual(result, ["OUT:ok", "ERR:(exit 1)"]);
});

test("cancelled appends (cancelled) via styleWarning", () => {
	const result = buildContent({ outputLines: ["ok"], status: "cancelled" });
	assert.deepEqual(result, ["OUT:ok", "WARN:(cancelled)"]);
});

test("truncation warning appended when truncated && fullOutputPath", () => {
	const result = buildContent({
		outputLines: ["ok"],
		status: "complete",
		truncated: true,
		fullOutputPath: "/tmp/full.txt",
	});
	assert.deepEqual(result, ["OUT:ok", "WARN:Output truncated. Full output: /tmp/full.txt"]);
});

test("long lines wrap via wrap (1 logical -> N wrapped, all present)", () => {
	const result = buildContent({ outputLines: ["abcdefghij"], innerWidth: 4, status: "complete" });
	assert.deepEqual(result, ["OUT:abcd", "OUT:efgh", "OUT:ij"]);
});

test("success with no output -> []", () => {
	const result = buildContent({ outputLines: [], status: "complete" });
	assert.deepEqual(result, []);
});

test("leading/trailing blank outputLines trimmed", () => {
	const result = buildContent({ outputLines: ["", "", "middle", "", ""], status: "complete" });
	assert.deepEqual(result, ["OUT:middle"]);
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
