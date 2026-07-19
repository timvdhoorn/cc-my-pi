import assert from "node:assert/strict";
import test from "node:test";
import { hexToAnsiFg } from "./spinner.ts";

test("hexToAnsiFg parses a valid lowercase hex color", () => {
	assert.equal(hexToAnsiFg("#d77757"), "\x1b[38;2;215;119;87m");
});

test("hexToAnsiFg parses uppercase hex digits", () => {
	assert.equal(hexToAnsiFg("#D77757"), "\x1b[38;2;215;119;87m");
});

test("hexToAnsiFg returns null for a theme-key string", () => {
	assert.equal(hexToAnsiFg("borderAccent"), null);
});

test("hexToAnsiFg returns null for a malformed hex string", () => {
	assert.equal(hexToAnsiFg("#fff"), null);
	assert.equal(hexToAnsiFg("d77757"), null);
});
