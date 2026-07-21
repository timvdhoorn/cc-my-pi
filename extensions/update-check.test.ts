import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatUpdateNotice, isCheckDue, readUpdateState } from "./update-check.ts";

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

test("formatUpdateNotice singular/plural", () => {
	assert.match(formatUpdateNotice(1, "/pkg"), /1 commit behind/);
	assert.match(formatUpdateNotice(3, "/pkg"), /3 commits behind/);
	assert.match(formatUpdateNotice(1, "/pkg"), /git -C \/pkg pull, then \/reload/);
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
	writeFileSync(path, JSON.stringify({ checkedAt: 42, behind: 2 }));
	assert.deepEqual(readUpdateState(path), { checkedAt: 42, behind: 2 });
});
