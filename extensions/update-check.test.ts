import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	formatUpdateNotice,
	isCheckDue,
	isNewerVersion,
	readUpdateState,
} from "./update-check.ts";

const DAY = 24 * 60 * 60 * 1000;

test("isCheckDue: no prior check → due", () => {
	assert.equal(isCheckDue({}, 1000), true);
});

test("isCheckDue: checked 1h ago → not due", () => {
	assert.equal(isCheckDue({ checkedAt: DAY }, DAY + 60 * 60 * 1000), false);
});

test("isCheckDue: checked 25h ago → due", () => {
	assert.equal(isCheckDue({ checkedAt: 0 }, DAY + 60 * 60 * 1000), true);
});

test("isNewerVersion: patch, minor, major", () => {
	assert.equal(isNewerVersion("1.1.1", "1.1.0"), true);
	assert.equal(isNewerVersion("1.2.0", "1.1.9"), true);
	assert.equal(isNewerVersion("2.0.0", "1.9.9"), true);
	assert.equal(isNewerVersion("1.1.0", "1.1.0"), false);
	assert.equal(isNewerVersion("1.0.9", "1.1.0"), false);
	assert.equal(isNewerVersion("1.10.0", "1.9.0"), true); // numeric, not lexicographic
});

test("isNewerVersion: non-semver input never triggers", () => {
	assert.equal(isNewerVersion("main", "1.1.0"), false);
	assert.equal(isNewerVersion("1.2.0", ""), false);
	assert.equal(isNewerVersion("", ""), false);
});

test("formatUpdateNotice includes versions, dir, /reload", () => {
	const msg = formatUpdateNotice("1.2.0", "1.1.0", "/pkg");
	assert.match(msg, /1\.2\.0 available/);
	assert.match(msg, /installed 1\.1\.0/);
	assert.match(msg, /\/pkg/);
	assert.match(msg, /\/reload/);
});

test("readUpdateState: missing or corrupt file → empty state", () => {
	const dir = mkdtempSync(join(tmpdir(), "ccmp-upd-"));
	assert.deepEqual(readUpdateState(join(dir, "nope.json")), {});
	const corrupt = join(dir, "bad.json");
	writeFileSync(corrupt, "not json");
	assert.deepEqual(readUpdateState(corrupt), {});
});

test("readUpdateState: valid file round-trips", () => {
	const dir = mkdtempSync(join(tmpdir(), "ccmp-upd-"));
	const path = join(dir, "state.json");
	writeFileSync(path, JSON.stringify({ checkedAt: 42, latest: "1.2.0" }));
	assert.deepEqual(readUpdateState(path), { checkedAt: 42, latest: "1.2.0" });
});
