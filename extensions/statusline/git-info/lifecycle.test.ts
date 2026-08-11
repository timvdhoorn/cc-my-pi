/**
 * Lifecycle regression test: background polling must survive a session whose
 * ExtensionContext is invalidated without session_shutdown.
 *
 * Embedded SDK sessions (e.g. pi-subagents) call `session.dispose()` directly,
 * which invalidates the extension runner without emitting session_shutdown.
 * The old implementation captured the ctx and dereferenced it from a 3s
 * polling fiber forever, logging "git-info background task defect" each tick.
 * The poller must instead detect staleness and stop quietly.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import gitInfo from "./index.ts";

const STALE_MESSAGE =
  "This extension ctx is stale after session replacement or reload.";

function createScratchRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "git-info-lifecycle-"));
  writeFileSync(join(repo, "file.txt"), "hello\n");
  execSync(
    [
      `cd ${JSON.stringify(repo)}`,
      "git init -q -b main .",
      "git config user.email test@test",
      "git config user.name test",
      "git add -A",
      "git commit -qm init",
    ].join(" && "),
    { stdio: "ignore" },
  );
  return repo;
}

interface MockContext {
  stale: boolean;
  readonly cwd: string;
  readonly mode: string;
  readonly hasUI: boolean;
  readonly signal: AbortSignal;
  readonly ui: Record<string, (...args: unknown[]) => void>;
}

function makeContext(cwd: string): MockContext {
  // Faithful to pi: every guarded ctx getter throws once the runner is stale.
  const context = {
    stale: false,
    get cwd(): string {
      if (context.stale) throw new Error(STALE_MESSAGE);
      return cwd;
    },
    get mode(): string {
      if (context.stale) throw new Error(STALE_MESSAGE);
      return "tui";
    },
    get hasUI(): boolean {
      if (context.stale) throw new Error(STALE_MESSAGE);
      return true;
    },
    signal: new AbortController().signal,
    ui: {
      notify: () => {},
      setHeader: () => {},
      setFooter: () => {},
      setTitle: () => {},
    },
  };
  return context;
}

function makePi() {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
  let gitInfoEmissions = 0;
  let counting = false;
  const pi = {
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand: () => {},
    events: {
      on: () => () => {},
      emit: (channel: string) => {
        if (channel === "dashboard:git-info" && counting) gitInfoEmissions += 1;
      },
    },
    startCounting: () => {
      counting = true;
    },
    emissions: () => gitInfoEmissions,
  };
  return {
    pi,
    emit: async (type: string, ctx: unknown) => {
      for (const handler of handlers.get(type) ?? []) {
        await handler({ type }, ctx);
      }
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("polling stops quietly when the session is invalidated without session_shutdown", async () => {
  const repo = createScratchRepo();
  const defectLines: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  const capture = (args: unknown[]) => {
    const text = args.map((value) => String(value)).join(" ");
    if (text.includes("git-info background task defect")) {
      defectLines.push(text);
    }
  };
  console.log = (...args: unknown[]) => {
    capture(args);
    realLog(...args);
  };
  console.error = (...args: unknown[]) => {
    capture(args);
    realError(...args);
  };

  try {
    const { pi, emit } = makePi();
    const ctx = makeContext(repo);
    gitInfo(pi as unknown as ExtensionAPI);
    await emit("session_start", ctx);

    // Let the poller start, then invalidate like AgentSession.dispose() does
    // for SDK sessions: no session_shutdown, guarded getters throw.
    await sleep(1200);
    ctx.stale = true;
    await sleep(1000); // let an in-flight refresh settle before measuring
    pi.startCounting();

    // Several poll intervals: the stale probe must end the loop on the first
    // tick, so nothing is emitted and nothing defects afterwards.
    await sleep(7000);

    assert.deepEqual(
      defectLines,
      [],
      "background polling must not log defects after ctx invalidation",
    );
    assert.equal(
      pi.emissions(),
      0,
      "background polling must stop after ctx invalidation",
    );
  } finally {
    console.log = realLog;
    console.error = realError;
    rmSync(repo, { recursive: true, force: true });
  }
});
