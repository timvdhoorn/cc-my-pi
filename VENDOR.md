# Vendored plugins

Single source of truth for third-party plugins bundled into cc-my-pi.
Sync workflow: invoke the `sync-vendored-plugins` skill (Pi-config root,
`.claude/skills/sync-vendored-plugins/`). Every entry lists the EXACT local
delta — a sync re-applies those items and nothing else; undocumented drift
in vendored files is a bug.

## extensions/queue-steer/

- **Upstream**: https://github.com/tmustier/pi-queue-steer
- **License**: MIT — Thomas Mustier
- **Pinned**: v0.1.0 / commit `c68ec21` (vendored 2026-07-20)
- **Files**: index.ts (adapted), queue-state.ts (verbatim),
  editor-render.ts (verbatim), queue-state.test.ts + editor-render.test.ts
  (ported: sibling import paths, register-fn call)
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
- **Replaced package entry**: `git:github.com/tmustier/pi-queue-steer`
  removed from `~/.pi/agent/settings.json` on 2026-07-20.

## extensions/claude-header/

- **Upstream**: https://github.com/Phoobobo/pi-claude-code-tui
- **License**: MIT — Phoobobo
- **Pinned**: v0.1.10 / commit `e5061f0` (vendored 2026-07-20)
- **Files**: index.ts (adapted from `extensions/claude-code-startup.ts`, header
  only), render-utils.ts (subset of upstream `extensions/render-utils.ts`,
  verbatim bodies — header helpers only, editor-only helpers omitted)
- **Local delta** (keep exactly these, nothing more):
  1. default export → `registerClaudeHeader(pi, enabled, hooks?)` with no
     default export, no `use-claude-code-tui` / `use-default-tui` commands,
     gated by `if (!enabled) return;`
  2. `HeaderHooks = { onTui?: (tui: TUI) => void }` — called from the setHeader
     factory so cc-my-pi's statusline module keeps its side effects
     (activeTui capture / requestRender wiring / theme-section removal)
  3. fixed tip `["use-default-tui"]` → `["cc-my-pi"]`
  4. tagline `"Let's build something great"` → `"cc-my-pi · Claude Code look for Pi"`
  5. sibling import specifiers (`./render-utils.ts`)
  6. dropped the editor half: `CodexStyleEditor`, `setEditorComponent`,
     `ctx.ui.setTitle("Pi")`
  - Harness note (not a semantic change): the `PiStartupHeader` constructor
    uses explicit field assignments instead of parameter properties, since
    cc-my-pi's tests run under Node's strip-types.
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
- **License**: MIT — Sanju, https://sanju.sh/
- **Pinned**: v1.0.3 (pre-manifest; pin on next sync)
- **Local delta**:
  1. exposed as `registerBundledDoubleEscClear(pi, isEnabled)` with live
     gate + `EDITOR_FEATURES` dedup marker
  2. transient right-aligned "Esc again to clear" hint widget (plan 016)
  3. works while the agent runs; busy first-Esc swallowed instead of
     falling through to abort (plan 018)
  4. duck-typed editor capability check instead of `instanceof
     CustomEditor` (cross-realm fix, commit f43a40f)
