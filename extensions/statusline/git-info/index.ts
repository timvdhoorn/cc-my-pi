/**
 * Statusline: git segment (branch, dirty/ahead-behind, commit age).
 *
 * Own code (not vendored): moved in from the owner's Pi-config
 * `packages/statusline` (2026-07-20), bundled here as the `statuslineEnabled`
 * module (registered from `extensions/index.ts` behind a reload gate).
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Effect, Fiber, Schedule } from "effect";
import {
  emptyGitInfoState,
  GIT_INFO_CHANNEL,
  REFRESH_CHANNEL,
  type PullRequestInfo,
} from "../shared/dashboard-state.ts";
import {
  loadChangedFiles,
  showChangedFiles,
} from "./src/changed-files-view.ts";
import { runCommand, type CommandRunner } from "./src/process.ts";
import { makeRefreshCoordinator } from "./src/refresh-coordinator.ts";
import {
  createRuntime,
  runEffect,
  type GitInfoRuntime,
} from "./src/runtime.ts";

const POLL_INTERVAL_MS = 3_000;
const GIT_TIMEOUT_MS = 3_000;
const GH_TIMEOUT_MS = 10_000;

function countChangedFiles(status: string) {
  if (!status.trim()) return 0;
  return status.split("\n").filter(Boolean).length;
}

export function parseShortstat(stdout: string): {
  insertions: number;
  deletions: number;
} {
  const insertions = /(\d+) insertion/.exec(stdout);
  const deletions = /(\d+) deletion/.exec(stdout);
  return {
    insertions: insertions ? Number.parseInt(insertions[1]!, 10) : 0,
    deletions: deletions ? Number.parseInt(deletions[1]!, 10) : 0,
  };
}

export function parseAheadBehind(
  code: number,
  stdout: string,
): { ahead: number | null; behind: number | null } {
  if (code !== 0) return { ahead: null, behind: null }; // no upstream
  const m = stdout.trim().match(/^(\d+)\s+(\d+)$/);
  if (!m) return { ahead: null, behind: null };
  return { behind: Number(m[1]), ahead: Number(m[2]) }; // left = upstream-only = behind
}

export function hasConflictMarkers(status: string): boolean {
  return /^(UU|AA|DD)/m.test(status);
}

function parsePullRequest(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  if (!("number" in value) || typeof value.number !== "number") return null;
  if (!("url" in value) || typeof value.url !== "string") return null;
  if (!("state" in value) || value.state !== "OPEN") return null;

  return {
    number: value.number,
    url: value.url,
    isDraft: "isDraft" in value && value.isDraft === true,
  } satisfies PullRequestInfo;
}

function parsePullRequestJson(value: string) {
  try {
    return parsePullRequest(JSON.parse(value));
  } catch {
    return null;
  }
}

export default function gitInfo(pi: ExtensionAPI) {
  let state = emptyGitInfoState();
  let runtime: GitInfoRuntime | undefined;
  let pollingFiber: Fiber.Fiber<void> | undefined;
  // Background work must never dereference a captured ExtensionContext: pi
  // invalidates it after session replacement/reload, and embedded sessions
  // (e.g. subagents) dispose without session_shutdown. Store the resolved cwd
  // string plus the ctx used only as a staleness probe.
  let currentSession: { ctx: ExtensionContext; cwd: string } | undefined;
  let generation = 0;
  let queriedPrBranch: string | null = null;
  const refreshCoordinator = makeRefreshCoordinator();

  const getRuntime = () => (runtime ??= createRuntime());
  const publish = () => pi.events.emit(GIT_INFO_CHANNEL, { ...state });
  const run = (
    command: string,
    args: string[],
    cwd: string,
    timeout: number,
  ) => runCommand(command, args, cwd, timeout);

  const readCwd = (ctx: ExtensionContext): string | undefined => {
    try {
      return ctx.cwd;
    } catch {
      return undefined;
    }
  };

  const isContextStale = (ctx: ExtensionContext): boolean => {
    try {
      void ctx.mode;
      return false;
    } catch {
      return true;
    }
  };

  const captureSession = (ctx: ExtensionContext): string | undefined => {
    const cwd = readCwd(ctx);
    if (cwd === undefined) return undefined;
    currentSession = { ctx, cwd };
    return cwd;
  };

  const lookupPullRequest = (cwd: string, branch: string) =>
    Effect.gen(function* () {
      const result = yield* run(
        "gh",
        ["pr", "view", branch, "--json", "number,url,state,isDraft"],
        cwd,
        GH_TIMEOUT_MS,
      );
      if (result.code !== 0) return null;
      return parsePullRequestJson(result.stdout);
    });

  const refreshEffect = (
    cwd: string,
    forcePullRequest: boolean,
    refreshGeneration: number,
  ) =>
    Effect.suspend(() => {
      if (refreshGeneration !== generation) return Effect.void;

      return Effect.gen(function* () {
        const repo = yield* run(
          "git",
          ["rev-parse", "--is-inside-work-tree"],
          cwd,
          GIT_TIMEOUT_MS,
        );
        if (refreshGeneration !== generation) return;

        if (repo.code !== 0 || repo.stdout.trim() !== "true") {
          queriedPrBranch = null;
          state = emptyGitInfoState();
          publish();
          return;
        }

        const [
          branchResult,
          headResult,
          statusResult,
          gitDirResult,
          aheadBehindResult,
          lastCommitResult,
          shortstatResult,
        ] = yield* Effect.all(
          [
            run("git", ["branch", "--show-current"], cwd, GIT_TIMEOUT_MS),
            run("git", ["rev-parse", "--short", "HEAD"], cwd, GIT_TIMEOUT_MS),
            run(
              "git",
              ["status", "--porcelain=v1", "--untracked-files=all"],
              cwd,
              GIT_TIMEOUT_MS,
            ),
            run("git", ["rev-parse", "--git-dir"], cwd, GIT_TIMEOUT_MS),
            run(
              "git",
              [
                "rev-list",
                "--left-right",
                "--count",
                "@{upstream}...HEAD",
              ],
              cwd,
              GIT_TIMEOUT_MS,
            ),
            run("git", ["log", "-1", "--format=%ct"], cwd, GIT_TIMEOUT_MS),
            run("git", ["diff", "--shortstat", "HEAD"], cwd, GIT_TIMEOUT_MS),
          ],
          { concurrency: "unbounded" },
        );
        if (refreshGeneration !== generation) return;

        const branchName = branchResult.stdout.trim();
        const shortHead = headResult.stdout.trim();
        const branch =
          branchName || (shortHead ? `detached@${shortHead}` : "detached");
        const branchChanged = branchName !== queriedPrBranch;
        const gitDir =
          gitDirResult.code === 0 ? gitDirResult.stdout.trim() : "";
        const worktreeName = gitDir.includes("/worktrees/")
          ? gitDir.slice(gitDir.lastIndexOf("/") + 1)
          : null;

        state = {
          ...state,
          isRepository: true,
          branch,
          changedFiles:
            statusResult.code === 0
              ? countChangedFiles(statusResult.stdout)
              : 0,
          pullRequest: branchChanged ? null : state.pullRequest,
          worktreeName,
          hasConflicts:
            statusResult.code === 0 &&
            hasConflictMarkers(statusResult.stdout),
          ...parseAheadBehind(
            aheadBehindResult.code,
            aheadBehindResult.stdout,
          ),
          ...(shortstatResult.code === 0
            ? parseShortstat(shortstatResult.stdout)
            : { insertions: 0, deletions: 0 }),
          lastCommitTs: (() => {
            const ts = Number(lastCommitResult.stdout.trim());
            return lastCommitResult.code === 0 &&
              Number.isFinite(ts) &&
              ts > 0
              ? ts
              : null;
          })(),
        };
        publish();

        if (!branchName) {
          // queriedPrBranch is never "", so branchChanged already cleared pullRequest.
          queriedPrBranch = null;
          return;
        }

        if (forcePullRequest || branchChanged) {
          queriedPrBranch = branchName;
          const pullRequest = yield* lookupPullRequest(cwd, branchName);
          if (refreshGeneration !== generation) return;
          state = { ...state, pullRequest };
          publish();
        }
      });
    });

  const refresh = (cwd: string, forcePullRequest = false) =>
    refreshCoordinator.run(refreshEffect(cwd, forcePullRequest, generation));

  const refreshIfIdle = (cwd: string) =>
    refreshCoordinator.runIfIdle(refreshEffect(cwd, false, generation));

  const reportBackgroundDefect = (defect: unknown) =>
    Effect.logError("git-info background task defect", defect);

  // Sentinel failure: ends the polling loop quietly when the session died
  // without session_shutdown (e.g. an SDK session disposed directly).
  const STALE_SESSION = "git-info/stale-session" as const;

  const poll = () =>
    Effect.suspend((): Effect.Effect<
      void,
      typeof STALE_SESSION,
      CommandRunner
    > => {
      const session = currentSession;
      if (!session) return Effect.void;
      if (isContextStale(session.ctx)) {
        currentSession = undefined;
        pollingFiber = undefined;
        return Effect.fail(STALE_SESSION);
      }
      return refreshIfIdle(session.cwd);
    }).pipe(
      Effect.catchDefect(reportBackgroundDefect),
      Effect.repeat(Schedule.fixed(POLL_INTERVAL_MS)),
      Effect.catchEager(() => Effect.void),
      Effect.delay(POLL_INTERVAL_MS),
      Effect.asVoid,
    );

  const forkBackground = (effect: Effect.Effect<void, never, CommandRunner>) =>
    getRuntime().runFork(
      effect.pipe(Effect.catchDefect(reportBackgroundDefect)),
    );

  const refreshInBackground = (cwd: string) => {
    forkBackground(refreshIfIdle(cwd));
  };

  pi.events.on(REFRESH_CHANNEL, () => {
    const session = currentSession;
    if (!session || isContextStale(session.ctx)) return;
    refreshInBackground(session.cwd);
  });

  pi.on("session_start", async (_event, ctx) => {
    generation += 1;
    queriedPrBranch = null;
    captureSession(ctx);

    const previousPollingFiber = pollingFiber;
    pollingFiber = undefined;
    if (previousPollingFiber) {
      await getRuntime().runPromise(Fiber.interrupt(previousPollingFiber));
    }

    const session = currentSession;
    if (!session) return;
    await runEffect(getRuntime(), refresh(session.cwd));
    pollingFiber = forkBackground(poll());
  });

  pi.on("input", (_event, ctx) => {
    const cwd = captureSession(ctx);
    if (cwd !== undefined) refreshInBackground(cwd);
    return { action: "continue" };
  });

  pi.on("tool_execution_end", (_event, ctx) => {
    const cwd = captureSession(ctx);
    if (cwd !== undefined) refreshInBackground(cwd);
  });

  pi.on("session_shutdown", async () => {
    generation += 1;
    currentSession = undefined;
    pollingFiber = undefined;
    const closing = runtime;
    runtime = undefined;
    await closing?.dispose();
  });

  pi.registerCommand("lg", {
    description: "Browse changed files and their diffs",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(
          "The local changes viewer requires the interactive TUI",
          "warning",
        );
        return;
      }

      const files = await runEffect(getRuntime(), loadChangedFiles(ctx.cwd), {
        signal: ctx.signal,
        interruptMessage: "Loading changed files was cancelled.",
      });
      if (files === null) {
        ctx.ui.notify("Not a git repository", "warning");
        return;
      }
      if (files.length === 0) {
        ctx.ui.notify("Working tree is clean", "info");
        return;
      }

      await showChangedFiles(ctx, files);
    },
  });

  pi.registerCommand("pr", {
    description: "Refresh git and pull request information",
    handler: async (_args, ctx) => {
      await runEffect(getRuntime(), refresh(ctx.cwd, true), {
        signal: ctx.signal,
        interruptMessage: "Git and pull request refresh was cancelled.",
      });
      if (!state.isRepository) {
        ctx.ui.notify("Not a git repository", "warning");
      } else if (state.pullRequest) {
        ctx.ui.notify(
          `PR #${state.pullRequest.number}: ${state.pullRequest.url}`,
          "info",
        );
      } else {
        ctx.ui.notify(`No open PR found for ${state.branch}`, "info");
      }
    },
  });
}
