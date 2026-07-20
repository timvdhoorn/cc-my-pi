import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasConflictMarkers, parseAheadBehind } from "./index.ts";
import { formatAgo } from "../ui-customization/index.ts";

describe("parseAheadBehind", () => {
  it("parses behind/ahead counts on success", () => {
    assert.deepEqual(parseAheadBehind(0, "2\t1\n"), { behind: 2, ahead: 1 });
  });

  it("returns nulls when there is no upstream", () => {
    assert.deepEqual(parseAheadBehind(128, ""), { ahead: null, behind: null });
  });

  it("returns nulls when the output cannot be parsed", () => {
    assert.deepEqual(parseAheadBehind(0, "garbage"), {
      ahead: null,
      behind: null,
    });
  });
});

describe("hasConflictMarkers", () => {
  it("detects UU conflict markers", () => {
    assert.equal(hasConflictMarkers("UU foo.ts\n"), true);
  });

  it("ignores plain modified/untracked entries", () => {
    assert.equal(hasConflictMarkers(" M foo.ts\n?? bar\n"), false);
  });

  it("detects AA conflict markers", () => {
    assert.equal(hasConflictMarkers("AA x\n"), true);
  });

  it("returns false for empty status", () => {
    assert.equal(hasConflictMarkers(""), false);
  });
});

describe("formatAgo", () => {
  const nowMs = 0;
  const at = (diffSeconds: number) => formatAgo(-diffSeconds, nowMs);

  it("formats seconds", () => {
    assert.equal(at(0), "0s");
    assert.equal(at(59), "59s");
  });

  it("formats minutes", () => {
    assert.equal(at(60), "1m");
    assert.equal(at(3_599), "59m");
  });

  it("formats hours", () => {
    assert.equal(at(3_600), "1h");
    assert.equal(at(86_399), "23h");
  });

  it("formats days", () => {
    assert.equal(at(86_400), "1d");
  });
});
