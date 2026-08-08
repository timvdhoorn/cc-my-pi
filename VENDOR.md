# Vendored plugins

Single source of truth for third-party plugins bundled into cc-my-pi.
Sync workflow: invoke the `sync-vendored-plugins` skill (Pi-config root,
`.claude/skills/sync-vendored-plugins/`). Every entry lists the EXACT local
delta — a sync re-applies those items and nothing else; undocumented drift
in vendored files is a bug.

## extensions/pi-tasks/

- **Upstream**: <https://github.com/tintinweb/pi-tasks>
- **License**: MIT — tintinweb (`extensions/pi-tasks/LICENSE`)
- **Pinned**: npm `@tintinweb/pi-tasks@0.7.2` (vendored 2026-08-07)
- **Files**: upstream `src/`, LICENSE, README and changelog; local tests live
  beside vendored source.
- **Local delta**:
  1. bundled from `extensions/index.ts`; removed from optional companion catalog
  2. animated widget replaced by one static `aboveEditor` task list: `✓` for
     completed, `□` for pending/in-progress, completed subject struck through
  3. display omits task IDs, runtime/token stats, animation and truncation
  4. Task tool calls/results stay model-visible but are hidden from transcript;
     only persistent lower task list is shown to user
  5. bundled Task tool definitions re-register at session start so this fork
     wins during migration when upstream package remains installed
- **Mutual exclusion**: remove `npm:@tintinweb/pi-tasks` from Pi package
  settings after upgrading; bundled definitions replace standalone package.

## extensions/queue-steer/

- **Upstream**: <https://github.com/tmustier/pi-queue-steer>
- **License**: MIT — Thomas Mustier
- **Pinned**: commit `d395e9b` (vendored 2026-08-05; was c68ec21 / v0.1.0)
- **Files**: index.ts (adapted), queue-state.ts (verbatim),
  editor-render.ts (verbatim), queue-state.test.ts + editor-render.test.ts
  - command-rows.test.ts (ported: sibling import paths, register-fn call)
- **Local delta** (keep exactly these, nothing more):
  1. default export → `registerBundledQueueSteer(pi, isEnabled)` with live
     gate (widget render + handleInput interception check `isEnabled()`)
  2. draft-aware Esc guard in the busy abort branch
     (`!editor.getText().trim()`)
  3. Esc abort-and-continue: `resumeOnSettle` flag — the queued message
     auto-sends at `agent_settled` (upstream stays paused until explicit
     Enter); corresponding test rewritten to the new contract
  4. queue-box help lines gain an `esc send now` hint on the non-paused
     lanes
  5. sibling import specifiers `./editor-render.ts` / `./queue-state.ts`
  6. attribution header comment
- **Upstream since previous pin** (kept):
  - command rows for `/compact [instructions]` and `/reload` (FIFO, idle-only)
  - mid-run Enter on `/reload` queues instead of Pi wait-warning; `/compact`
    keeps built-in Enter behaviour
  - restore rows queued behind `/reload` after runtime swap
  - idle Option+Enter command submissions execute instead of LLM text
- **Replaced package entry**: `git:github.com/tmustier/pi-queue-steer`
  removed from `~/.pi/agent/settings.json` on 2026-07-20.

## extensions/claude-header/

- **Upstream**: <https://github.com/Phoobobo/pi-claude-code-tui>
- **License**: MIT — Phoobobo (attribution retained in `index.ts`)
- **FORKED 2026-07-20 (plan 031)** — attribution only; do not sync via
  sync-vendored-plugins. The layout, the π mascot (`pi-mascot.ts`) and the
  right-column Loaded panel (`loaded-stats.ts`) are original cc-my-pi work; only
  the box-drawing scaffolding and the setHeader/onTui registration shape descend
  from upstream commit `e5061f0`. Future upstream changes are irrelevant.
- **Mutual exclusion**: no shared feature marker upstream — do NOT install
  `npm:pi-claude-code-tui` alongside (both would render a header).

## extensions/esc-steer.ts

- **Upstream**: standalone `pi-esc-steer` package (Thomas Mustier)
- **License**: MIT — Thomas Mustier
- **Pinned**: vendored 2026-07 (pre-manifest; pin on next sync)
- **Local delta**:
  1. exposed as `registerBundledEscSteer(pi, isEnabled)` with live gate
  2. shares the `esc-steer` feature marker with the standalone package
     (mutual exclusion)
  3. `draftIsEmpty()` guard — abort-and-continue only arms on an empty
     chatbox (2026-07-20, plan 018)

## extensions/double-esc-clear.ts

- **Upstream**: `@thisux/pi-double-esc-clear` v1.0.3 (npm)
- **License**: MIT — Sanju, <https://sanju.sh/>
- **Pinned**: v1.0.3 (pre-manifest; pin on next sync)
- **Local delta**:
  1. exposed as `registerBundledDoubleEscClear(pi, isEnabled)` with live
     gate + `EDITOR_FEATURES` dedup marker
  2. transient right-aligned "Esc again to clear" hint widget (plan 016)
  3. works while the agent runs; busy first-Esc swallowed instead of
     falling through to abort (plan 018)
  4. duck-typed editor capability check instead of `instanceof
     CustomEditor` (cross-realm fix, commit f43a40f)
