import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	formatUpdateNotice,
	installedVersion,
	installedViaNpm,
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

test("formatUpdateNotice: npm vs local instruction", () => {
	const npmMsg = formatUpdateNotice("1.2.0", "1.1.0", true);
	assert.match(npmMsg, /1\.2\.0 available/);
	assert.match(npmMsg, /installed 1\.1\.0/);
	assert.match(npmMsg, /pi install npm:cc-my-pi/);
	assert.match(npmMsg, /\/reload/);
	assert.match(formatUpdateNotice("1.2.0", "1.1.0", false), /update your local copy/);
});

test("installedVersion: reads own package.json via module location", () => {
	// Runs from the real repo checkout: extensions/.. holds package.json.
	const v = installedVersion(join(process.cwd(), "extensions"));
	assert.match(v ?? "", /^\d+\.\d+\.\d+/);
});

test("installedVersion: unknown dir → undefined", () => {
	assert.equal(installedVersion("/nonexistent/nowhere"), undefined);
});

test("installedViaNpm: detects npm:cc-my-pi entry, not lookalikes", () => {
	const dir = mkdtempSync(join(tmpdir(), "ccmp-upd-"));
	const path = join(dir, "settings.json");
	writeFileSync(path, JSON.stringify({ packages: ["npm:cc-my-pi"] }));
	assert.equal(installedViaNpm(path), true);
	writeFileSync(path, JSON.stringify({ packages: ["npm:cc-my-pi@1.2.0"] }));
	assert.equal(installedViaNpm(path), true);
	writeFileSync(path, JSON.stringify({ packages: ["/local/cc-my-pi", "npm:cc-my-pi-extras"] }));
	assert.equal(installedViaNpm(path), false);
	assert.equal(installedViaNpm(join(dir, "missing.json")), false);
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
