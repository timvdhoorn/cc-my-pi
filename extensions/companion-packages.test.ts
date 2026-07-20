import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPANION_PACKAGES,
  createPiPackagesFile,
} from "./companion-packages.ts";

const SRC = "npm:pi-context-view";

/** Fresh temp settings.json path with the given contents (raw string). */
function tmpSettings(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ccpi-companions-"));
  const path = join(dir, "settings.json");
  writeFileSync(path, contents);
  return path;
}

test("catalog: six MIT companion packages, unique sources", () => {
  assert.equal(COMPANION_PACKAGES.length, 6);
  const sources = COMPANION_PACKAGES.map((c) => c.source);
  assert.equal(new Set(sources).size, sources.length);
  for (const c of COMPANION_PACKAGES) {
    assert.ok(c.source.startsWith("npm:"), `${c.name} source is an npm ref`);
    assert.ok(c.name.length > 0 && c.blurb.length > 0);
  }
});

test("isInstalled: true for a plain-string entry", () => {
  const path = tmpSettings(JSON.stringify({ packages: [SRC] }));
  assert.equal(createPiPackagesFile(path).isInstalled(SRC), true);
});

test("isInstalled: true for an object { source } entry", () => {
  const path = tmpSettings(JSON.stringify({ packages: [{ source: SRC }] }));
  assert.equal(createPiPackagesFile(path).isInstalled(SRC), true);
});

test("isInstalled: false when the package is absent", () => {
  const path = tmpSettings(JSON.stringify({ packages: ["npm:other"] }));
  assert.equal(createPiPackagesFile(path).isInstalled(SRC), false);
});

test("isInstalled: false when packages key is missing", () => {
  const path = tmpSettings(JSON.stringify({ theme: "dark" }));
  assert.equal(createPiPackagesFile(path).isInstalled(SRC), false);
});

test("isInstalled: false on a missing file (never throws)", () => {
  const path = join(mkdtempSync(join(tmpdir(), "ccpi-companions-")), "nope.json");
  assert.equal(createPiPackagesFile(path).isInstalled(SRC), false);
});

test("isInstalled: false on invalid JSON (never throws)", () => {
  const path = tmpSettings("{ not json ");
  assert.equal(createPiPackagesFile(path).isInstalled(SRC), false);
});

test("install: appends and persists (re-read shows it)", () => {
  const path = tmpSettings(JSON.stringify({ packages: ["npm:other"] }));
  const file = createPiPackagesFile(path);
  file.install(SRC);
  assert.equal(file.isInstalled(SRC), true);
  const settings = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(settings.packages, ["npm:other", SRC]);
});

test("install: is idempotent (no duplicate on second call)", () => {
  const path = tmpSettings(JSON.stringify({ packages: [SRC] }));
  const file = createPiPackagesFile(path);
  file.install(SRC);
  const settings = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(settings.packages, [SRC]);
});

test("install: creates the packages array when missing", () => {
  const path = tmpSettings(JSON.stringify({ theme: "dark" }));
  const file = createPiPackagesFile(path);
  file.install(SRC);
  const settings = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(settings.packages, [SRC]);
  assert.equal(settings.theme, "dark", "preserves unrelated keys");
});

test("install: throws on invalid JSON without modifying the file", () => {
  const raw = "{ not json ";
  const path = tmpSettings(raw);
  const file = createPiPackagesFile(path);
  assert.throws(() => file.install(SRC));
  assert.equal(readFileSync(path, "utf8"), raw, "file left untouched after failed parse");
});
