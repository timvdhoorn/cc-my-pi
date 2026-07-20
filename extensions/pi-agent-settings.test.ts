import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createQuietStartupFile } from "./pi-agent-settings.ts";

function tmpFile(name = "settings.json"): string {
	return join(mkdtempSync(join(tmpdir(), "cc-quiet-")), name);
}

test("read defaults to false when the file or key is missing", () => {
	const missingFile = createQuietStartupFile(join(mkdtempSync(join(tmpdir(), "cc-quiet-")), "nope.json"));
	assert.equal(missingFile.read(), false);

	const path = tmpFile();
	writeFileSync(path, JSON.stringify({ theme: "dark" }));
	assert.equal(createQuietStartupFile(path).read(), false, "key absent → false");
});

test("read returns true only for an explicit true", () => {
	const path = tmpFile();
	writeFileSync(path, JSON.stringify({ quietStartup: true }));
	assert.equal(createQuietStartupFile(path).read(), true);
	writeFileSync(path, JSON.stringify({ quietStartup: false }));
	assert.equal(createQuietStartupFile(path).read(), false);
});

test("write sets quietStartup while preserving all other keys and file style", () => {
	const path = tmpFile();
	writeFileSync(path, `${JSON.stringify({ packages: ["npm:foo"], theme: "dark" }, null, 2)}\n`);

	createQuietStartupFile(path).write(true);

	const raw = readFileSync(path, "utf8");
	const parsed = JSON.parse(raw);
	assert.equal(parsed.quietStartup, true);
	assert.deepEqual(parsed.packages, ["npm:foo"], "unrelated array survives");
	assert.equal(parsed.theme, "dark", "unrelated key survives");
	assert.ok(raw.endsWith("\n"), "trailing newline");
	assert.ok(raw.includes('  "'), "2-space indent");
});

test("write creates the file when it does not exist", () => {
	const path = join(mkdtempSync(join(tmpdir(), "cc-quiet-")), "new.json");
	createQuietStartupFile(path).write(true);
	assert.equal(JSON.parse(readFileSync(path, "utf8")).quietStartup, true);
});

test("write never clobbers an unparseable file", () => {
	const path = tmpFile();
	const garbage = "{ this is : not json";
	writeFileSync(path, garbage);
	createQuietStartupFile(path).write(true);
	assert.equal(readFileSync(path, "utf8"), garbage, "left untouched");
});
