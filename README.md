# cc-my-pi

> Personal Pi UI bundle — Claude Code-inspired tool rendering, spinner, themes, and esc/queue steering. Fork of [pi-cc-tools](https://github.com/FammasMaz/pi-cc-tools) (npm `pi-claude-code-ui`), heavily adapted. See [Credits & provenance](#credits--provenance).

Loaded by local path from `~/.pi/agent/settings.json` (not published to npm):

```json
"packages": ["/path/to/Pi-config/cc-my-pi"]
```

Claude Code inspired tool rendering for Pi — Shiki-powered diffs, status dots, branch connectors, file icons, and configurable output modes.

## Features

- **Compact built-in tool rendering** for `read`, `bash`, `grep`, `find`, `ls`, `edit`, and `write`
- **Claude-style OpenAI tool rendering** for `apply_patch` plus common Pi/OpenAI-style tools like `webfetch`, `web_search`, `fetch_content`, task tools, and context tools
- **`apply_patch` diff previews** that render parsed file patches in the call phase, similar to `edit`/`write`
- **Adaptive edit/write diffs** with split or unified layouts, syntax highlighting, and inline word-level emphasis
- **Diff stat bar** with colored add/remove summary and hunk metadata
- **Progressive collapsed diff hints** that shorten on narrow terminals
- **Thinking labels** during streaming and final messages, with context sanitization
- **MCP-aware rendering** with hidden, summary, and preview modes
- **Configurable output modes** for read, search, bash, and MCP results
- **Live running previews** that show a few output lines for active tool calls (latest lines for bash), persisting until the next tool/text activity
- **Subagent completion notifications** restyled to match the same Claude-style tool rows
- **RTK rewrite integration** that folds rewrite notices into the bash tool row with a muted `(RTK)` badge and expanded-only rewrite details
- **Built-in image paster** — clipboard images and pasted image paths become first-class attachments through bundled `pi-paster` (toggle with `imagePasterEnabled`)
- **Bundled Esc behaviors** — Claude Code's two Escape reflexes, both on by default and toggleable live from `/cc-my-pi`: Esc while the agent runs aborts and auto-continues whatever was queued (`escSteerEnabled`), and double-Esc on a non-empty idle draft clears it (`doubleEscClearEnabled`)
- **Transparent tool backgrounds** in `transparent` or `border` mode
- **Theme-adaptive palette** — borders, branch connectors, dim text, spinner accent, and diff backgrounds automatically follow the active pi theme (set `themeAdaptive: false` to keep the fixed Claude-style palette)
- **Light Ghostty-sync themes** — edit/write diffs use `github-light` highlighting and light-tinted diff rows; tool pending dots use softer chrome colors
- **Transparent edit/write diffs** with universal red/green diff colors
- **Grouped consecutive tool calls** with a compact status header and per-tool glance rows (set `groupToolCalls: false` to disable)
- **Extra detail toggle** with `Ctrl+Shift+O`, increasing expanded preview caps without making the default view heavy
- **Global border patch** for all tool rows, including unknown/custom tools

## Configuration

Set in `.pi/settings.json` or `~/.pi/settings.json`:

```json
{
  "toolBackground": "border",
  "readOutputMode": "preview",
  "searchOutputMode": "preview",
  "mcpOutputMode": "preview",
  "previewLines": 8,
  "expandedPreviewMaxLines": 4000,
  "extraExpandedPreviewMaxLines": 12000,
  "extraToolOutputExpanded": false,
  "groupToolCalls": true,
  "bashOutputMode": "opencode",
  "bashCollapsedLines": 10,
  "liveToolPreview": true,
  "liveToolPreviewLines": 5,
  "diffCollapsedLines": 24,
  "themeAdaptive": true,
  "diffTheme": "github-dark",
  "assistantListBulletStyle": "default",
  "imagePasterEnabled": true,
  "escSteerEnabled": true,
  "doubleEscClearEnabled": true
}
```

### Theme integration

When `themeAdaptive` is `true` (default), the following colors are derived from the active pi theme on every render and re-derived whenever the theme changes:

| Element | Derived from |
| --------- | -------------- |
| User box, tool rules, code fences | `dim` → `muted` → `borderMuted` → `thinkingText` |
| Branch connectors (`├`, `└`, `│`) | **fixed rgb(72)** by default (theme-independent); `/cc-my-pi branch theme` to follow pi theme |
| "✻ Turn took Ns" line (final message only, with session total + turn count) | `muted` |
| Thinking-block text and `∴` marker (marker hidden when thinking is collapsed) | `muted` |
| Diff add/remove accents | `toolDiffAdded` / `toolDiffRemoved` |
| Diff background tints | mixed against `toolSuccessBg` base |
| Spinner verb text (`Working…`) | `borderAccent` (fallback: `accent`) |
| Spinner status text | `muted` |

User-supplied `diffTheme` presets and `diffColors` overrides always win over theme-derived defaults. File-type icons (e.g. `ts`, `py`, `rs`) keep their language-identity colors and are not theme-derived.

Set `themeAdaptive: false` to keep the original fixed Claude-style palette regardless of the active pi theme.

On `/resume`, `/new`, or `/fork`, tool chrome is rebound from the **current** pi theme (no coupling to Ghostty or other theme extensions). If you use Ghostty sync, listing it **above** this extension in `settings.json` is recommended so `setTheme` runs before chrome rebind.

#### Toggle at runtime with `/cc-my-pi theme`

```text
/cc-my-pi theme           # show current setting + theme name
/cc-my-pi theme status    # show current setting + color preview (incl. spinner)
/cc-my-pi theme on        # follow pi theme
/cc-my-pi theme off       # keep fixed Claude palette
/cc-my-pi theme toggle    # flip the current value
```

The selection is persisted to `~/.pi/settings.json` and applied to the next rendered tool row. No restart required.

#### Repaint the spinner with `/cc-my-pi spinner`

The spinner glyph itself is still colored by pi's loader using `accent`, while the verb text (e.g. `Cooking…`) follows `borderAccent` by default so it stays lively without being the exact same color as the glyph. The status suffix (e.g. `(thinking · ↓ 10 tokens · 2s)`) follows `muted`. Use `/cc-my-pi spinner` to bind either text element to any other theme color key:

```text
/cc-my-pi spinner preview          # list every common theme key with a colored sample
/cc-my-pi spinner verb <key>       # change the verb color (e.g. thinkingHigh, mdHeading)
/cc-my-pi spinner status <key>     # change the status suffix color
/cc-my-pi spinner reset            # restore defaults (verb=borderAccent, status=muted)
```

The selection is persisted as `spinnerVerbColor` / `spinnerStatusColor` in `~/.pi/settings.json` and applied on the next spinner tick.

`spinnerVerbColor`, `spinnerStatusColor`, and `spinnerGlyphColor` also accept a `#rrggbb` hex literal instead of a theme key — a hex value bypasses theme lookup entirely and always renders that exact color, even with `themeAdaptive: false` or no theme loaded. `spinnerGlyphColor` (unset by default) overrides the glyph color that pi's loader would otherwise pick; set it to bind the glyph to the same brand color as the verb, e.g.:

```json
{
  "spinnerVerbColor": "#d77757",
  "spinnerGlyphColor": "#d77757"
}
```

### Tool background modes

| Value | Behavior |
| ------- | ---------- |
| `default` | Standard Pi tool backgrounds |
| `transparent` | Transparent tool backgrounds |
| `border` | Transparent backgrounds with top/bottom border lines |

Use `/cc-my-pi` to control tool UI at runtime:

```text
/cc-my-pi                 # open interactive settings panel (live ASCII preview)
/cc-my-pi ui              # same as bare /cc-my-pi
/cc-my-pi status          # text dump of style, grouping, bullets, branch
/cc-my-pi outlines        # tool style: outlines, transparent, or default
/cc-my-pi group toggle    # toggle grouped adjacent/concurrent tool calls
/cc-my-pi group off       # disable grouping (also ungroups current grouped rows)
/cc-my-pi detail toggle   # same mode as Ctrl+Shift+O
/cc-my-pi bullets default # use Pi theme's native list marker
/cc-my-pi bullets dash    # force plain markdown "-" markers
/cc-my-pi bullets toggle  # flip default ↔ dash
```

The settings panel lists style, grouping, extra detail, branch color, list bullets, image paster, Esc continues queue, double-Esc clears draft, theme-adaptive, live preview, and read/bash output modes. Most changes apply immediately; changing Image paster requires `/reload`. The preview block under the list shows a mock tool tree for the current combination.

`assistantListBulletStyle` only affects **assistant Markdown unordered lists** (the rows that this package restyles). Thinking blocks and user messages are unchanged.

### Bundled Esc behaviors

Two Escape reflexes from Claude Code ship bundled and **default to on**. Toggle
either live from the `/cc-my-pi` settings panel (no reload needed):

| Setting | Default | Behavior |
| --------- | --------- | ---------- |
| `escSteerEnabled` | `true` | While the agent runs, Esc aborts the current run and then auto-continues whatever was queued (steer / follow-up) instead of only pausing. Composes with the optional `git:github.com/tmustier/pi-queue-steer` package and with Pi's native queue. |
| `doubleEscClearEnabled` | `true` | On a non-empty idle draft, double-Esc (within 800 ms) clears the editor, matching Claude Code. Pi's own empty-editor double-Esc (tree / fork selector) is untouched. |

`escSteerEnabled` is the bundled copy of the standalone `pi-esc-steer` package
and shares its feature marker, so the two are mutually exclusive automatically.
`doubleEscClearEnabled` is vendored from
[`@thisux/pi-double-esc-clear`](https://www.npmjs.com/package/@thisux/pi-double-esc-clear)
v1.0.3 (MIT, author Sanju <https://sanju.sh/>).

If you previously installed either standalone package, remove it so it is not
loaded twice:

```bash
pi remove npm:pi-esc-steer
pi remove npm:@thisux/pi-double-esc-clear
```

esc-steer dedups automatically via the shared feature marker; double-esc-clear
cannot detect the standalone package, so a leftover install would double-wrap
(harmless — the inner clear empties the draft and the outer sees nothing to do —
but removing it is cleaner).

### Output modes

| Setting | Values | Default |
| --------- | -------- | --------- |
| `readOutputMode` | `hidden`, `summary`, `preview` | `preview` |
| `searchOutputMode` | `hidden`, `count`, `preview` | `preview` |
| `mcpOutputMode` | `hidden`, `summary`, `preview` | `preview` |
| `bashOutputMode` | `opencode`, `summary`, `preview` | `opencode` |

### Display settings

| Setting | Default | Description |
| --------- | --------- | ------------- |
| `previewLines` | `8` | Lines shown in collapsed preview mode |
| `expandedPreviewMaxLines` | `4000` | Max lines when expanded with Ctrl+O |
| `extraExpandedPreviewMaxLines` | `12000` | Max lines after Ctrl+Shift+O extra-detail mode |
| `extraToolOutputExpanded` | `false` | Start with Ctrl+Shift+O extra-detail mode enabled |
| `groupToolCalls` | `true` | Group adjacent/concurrent tool calls under a compact status header |
| `bashCollapsedLines` | `10` | Lines for collapsed bash output |
| `liveToolPreview` | `true` | Show a small live output preview while tools are still running |
| `liveToolPreviewLines` | `5` | Lines shown in the collapsed live preview |
| `diffCollapsedLines` | `24` | Diff lines before collapsing |
| `assistantListBulletStyle` | `default` | Assistant unordered list markers: Pi theme `default` or forced `dash` (`-`) |
| `imagePasterEnabled` | `true` | Bundle clipboard-image and pasted-image-path attachments; reload after changing |

## Notes

This package targets recent Pi versions where tool renderers use:

- `renderCall(args, theme, context)`
- `renderResult(result, { expanded, isPartial }, theme, context)`

Unknown/custom tools do not have a public global renderer hook in Pi, so this package patches container rendering to add top/bottom borders for all tool executions in border mode.

## Credits & provenance

cc-my-pi is not an original work — it stands on these projects:

| Component | Upstream | Author | License |
|---|---|---|---|
| Core tool rendering, diffs, spinner, settings UI (base fork) | [FammasMaz/pi-cc-tools](https://github.com/FammasMaz/pi-cc-tools) (npm `pi-claude-code-ui`) | FammasMaz | MIT |
| `extensions/queue-steer/` (vendored, adapted) | [tmustier/pi-queue-steer](https://github.com/tmustier/pi-queue-steer) | Thomas Mustier | MIT |
| `extensions/esc-steer.ts` (vendored, adapted) | `pi-esc-steer` | Thomas Mustier | MIT |
| `extensions/double-esc-clear.ts` (vendored, adapted) | [`@thisux/pi-double-esc-clear`](https://www.npmjs.com/package/@thisux/pi-double-esc-clear) v1.0.3 | [Sanju](https://sanju.sh/) | MIT |
| Visual design reference | [Claude Code](https://github.com/anthropics/claude-code) (Anthropic) — glyphs, colors, and layout re-implemented, no code copied | — | — |
| Syntax highlighting | [Shiki](https://shiki.style) (`@shikijs/cli`) | Shiki contributors | MIT |
| Diff engine | [jsdiff](https://github.com/kpdecker/jsdiff) (`diff`) | Kevin Decker & contributors | BSD-3-Clause |
| Image pasting | `pi-paster` | — | see package |

The base fork itself builds upon and was inspired by:

- **[@heyhuynhgiabuu/pi-pretty](https://github.com/buddingnewinsights/pi-pretty)** by [huynhgiabuu](https://github.com/buddingnewinsights) — Pretty terminal output with syntax-highlighted file reads, colored bash output, and tree-view directory listings
- **[@heyhuynhgiabuu/pi-diff](https://github.com/buddingnewinsights/pi-diff)** by [huynhgiabuu](https://github.com/buddingnewinsights) — Shiki-powered terminal diff renderer with word-level diffs in split and unified views
- **[pi-tool-display](https://github.com/MasuRii/pi-tool-display)** by [MasuRii](https://github.com/MasuRii) — Compact tool call rendering, diff visualization, and output truncation

Vendored-copy details, pinned versions, and the exact local deltas live in
[VENDOR.md](./VENDOR.md). The base fork has diverged substantially from
upstream (see [CHANGELOG.md](./CHANGELOG.md) and the `plans/` history in the
parent Pi-config repo); bugs here are mine, not the upstream authors'.
