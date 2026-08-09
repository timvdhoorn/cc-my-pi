/**
 * Statusline: footer composition (assembles the model / git / MCP segments).
 *
 * Own code (not vendored): moved in from the owner's Pi-config
 * `packages/statusline` (2026-07-20), bundled here as the `statuslineEnabled`
 * module (registered from `extensions/index.ts` behind a reload gate). Still
 * reads the optional `bg-terminals` status string by name (loose coupling —
 * no-op when that separate, unbundled extension is absent).
 */
import { homedir } from "node:os";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  hyperlink,
  truncateToWidth,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  emptyGitInfoState,
  emptyModelInfoState,
  GIT_INFO_CHANNEL,
  MODEL_INFO_CHANNEL,
  REFRESH_CHANNEL,
  isGitInfoState,
  isModelInfoState,
} from "../shared/dashboard-state.ts";
import { readStatuslineSettings } from "../shared/settings.ts";

interface RenderableNode {
  children?: RenderableNode[];
  invalidate(): void;
  render(width: number): string[];
}

interface DashboardTui extends RenderableNode {
  requestRender(force?: boolean): void;
}

/**
 * Pi default stack: ... | editor | widgetBelow | footer.
 * FleetView (pi-subagents) sits in widgetBelow — only aboveEditor|belowEditor
 * placements exist upstream. Move our footer above widgetBelow so main/worker
 * rows land under mem/caveman. Lives here (not pi-subagents) so package updates
 * don't clobber it. Idempotent: no-op when footer already not last.
 */
function placeFooterAboveBelowEditorWidgets(
  tui: DashboardTui,
  footer: RenderableNode,
): boolean {
  const children = tui.children;
  if (!Array.isArray(children) || children.length < 2) return false;
  const footerIndex = children.indexOf(footer);
  if (footerIndex === -1) return false;
  // Already above trailing below-editor widgets.
  if (footerIndex !== children.length - 1) return false;
  const belowIndex = footerIndex - 1;
  const below = children[belowIndex];
  if (!below) return false;
  children[belowIndex] = footer;
  children[footerIndex] = below;
  tui.requestRender(true);
  return true;
}

function scheduleFooterAboveFleet(
  tui: DashboardTui,
  footer: RenderableNode,
  timers: Array<ReturnType<typeof setTimeout>>,
) {
  // setFooter addChild runs after factory returns — microtask + short retries.
  queueMicrotask(() => placeFooterAboveBelowEditorWidgets(tui, footer));
  for (const delay of [0, 50, 250, 1_000]) {
    timers.push(
      setTimeout(() => placeFooterAboveBelowEditorWidgets(tui, footer), delay),
    );
  }
}

const RESET = "\x1b[0m";
const CLAUDE_ORANGE = "\x1b[38;2;215;119;87m";
const DIM_GRAY = "\x1b[38;2;153;153;153m";
const GRAY = "\x1b[0;38;2;127;132;156m";
const TEXT = "\x1b[0;1;38;2;205;214;244m";
const MAUVE = "\x1b[0;1;38;2;203;166;247m";
const GREEN = "\x1b[0;1;38;2;166;227;161m";
const YELLOW = "\x1b[0;1;38;2;249;226;175m";
const PEACH = "\x1b[0;1;38;2;250;179;135m";
const MAROON = "\x1b[0;1;38;2;235;160;172m";
const RED = "\x1b[0;1;38;2;243;139;168m";
const SKY = "\x1b[0;1;38;2;137;220;235m";

type ThemeColor = Parameters<ExtensionContext["ui"]["theme"]["fg"]>[0];

// Match the editor-border thinking colors (Pi's own theme keys).
const THINKING_THEME_KEY: Record<string, ThemeColor> = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
};
const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function hasChildren(
  component: RenderableNode,
): component is RenderableNode & { children: RenderableNode[] } {
  return Array.isArray(component.children);
}

function renderedText(component: RenderableNode) {
  try {
    return component.render(200).join("\n").replace(ANSI_PATTERN, "");
  } catch {
    return "";
  }
}

function hideThemesSection(component: RenderableNode) {
  if (!hasChildren(component)) return false;

  for (let index = 0; index < component.children.length; index += 1) {
    const child = component.children[index]!;
    const firstLine = renderedText(child)
      .split("\n")
      .find((line) => line.trim())
      ?.trim();

    if (firstLine === "[Themes]") {
      const removeCount =
        component.children[index + 1] &&
        renderedText(component.children[index + 1]!).trim() === ""
          ? 2
          : 1;
      component.children.splice(index, removeCount);
      component.invalidate();
      return true;
    }

    if (hideThemesSection(child)) return true;
  }

  return false;
}

function formatTokens(tokens: number) {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

function contextColor(theme: ExtensionContext["ui"]["theme"], percent: number) {
  if (percent < 20) return (text: string) => theme.fg("success", text);
  if (percent < 40) return (text: string) => theme.fg("warning", text);
  if (percent < 60) return (text: string) => theme.fg("accent", text);
  if (percent < 80) return (text: string) => theme.fg("warning", text);
  return (text: string) => theme.fg("error", text);
}

function progressBar(percent: number, cells = 6) {
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)));
  return `${"█".repeat(filled)}${"░".repeat(cells - filled)}`;
}

function ctxRampAnsi(pct: number) {
  if (pct < 20) return GREEN;
  if (pct < 40) return YELLOW;
  if (pct < 60) return PEACH;
  if (pct < 80) return MAROON;
  return RED;
}

export function formatAgo(unixSeconds: number, nowMs = Date.now()): string {
  const diff = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
  if (diff < 60) return `${diff}s`;
  if (diff < 3_600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86_400) return `${Math.floor(diff / 3_600)}h`;
  return `${Math.floor(diff / 86_400)}d`;
}

const EIGHTHS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

function smoothBar(pct: number, cells = 6) {
  const eighths = Math.floor((pct * cells * 8 + 50) / 100);
  const full = Math.floor(eighths / 8);
  const rem = eighths % 8;
  let bar = "█".repeat(Math.min(full, cells));
  let used = Math.min(full, cells);
  if (rem > 0 && used < cells) {
    bar += EIGHTHS[rem];
    used += 1;
  }
  if (used < cells) bar += " ".repeat(cells - used);
  return bar;
}

function compactStatus(
  statuses: ReadonlyMap<string, string>,
  key: string,
  fallbackLabel: string,
  theme: ExtensionContext["ui"]["theme"],
  grayText?: (text: string) => string,
) {
  const raw = statuses.get(key)?.replace(ANSI_PATTERN, "").trim();
  if (!raw) return undefined;

  if (key === "caveman") {
    const level = raw.match(/caveman level:\s*(\S+)/i)?.[1];
    return level
      ? `${grayText?.("caveman") ?? theme.fg("dim", "caveman")} ${theme.fg("text", level.toLowerCase())}`
      : undefined;
  }

  if (key === "mcp") {
    const details = raw
      .replace(/^🔌?\s*MCP:\s*/u, "")
      .replace(/\bservers?\b\s*/iu, "")
      .trim();
    const prefix = grayText?.("mcp") ?? theme.fg("muted", "mcp");
    return details ? `${prefix} ${theme.fg("accent", details)}` : prefix;
  }

  return theme.fg("muted", raw || fallbackLabel);
}

function formatDirectory(cwd: string) {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`;
  return cwd;
}

export default function uiCustomization(
  pi: ExtensionAPI,
  opts?: { skipHeader?: boolean },
) {
  let title = "pi";
  let modelInfo = emptyModelInfoState();
  let gitInfo = emptyGitInfoState();
  let requestRender: (() => void) | undefined;
  let activeTui: DashboardTui | undefined;
  let themeRemovalTimers: Array<ReturnType<typeof setTimeout>> = [];
  let footerLayoutTimers: Array<ReturnType<typeof setTimeout>> = [];

  const stopModelListener = pi.events.on(MODEL_INFO_CHANNEL, (value) => {
    if (!isModelInfoState(value)) return;
    modelInfo = value;
    requestRender?.();
  });

  const stopGitListener = pi.events.on(GIT_INFO_CHANNEL, (value) => {
    if (!isGitInfoState(value)) return;
    gitInfo = value;
    requestRender?.();
  });

  function scheduleThemeRemoval(tui: DashboardTui) {
    for (const timer of themeRemovalTimers) clearTimeout(timer);
    themeRemovalTimers = [];

    for (const delay of [0, 50, 250, 1_000]) {
      themeRemovalTimers.push(
        setTimeout(() => {
          if (hideThemesSection(tui)) tui.requestRender(true);
        }, delay),
      );
    }
  }

  // Side effects the header factory owns (capture the tui, wire requestRender,
  // schedule the [Themes] section removal). Exported as the `onTui` hook so the
  // vendored claude-header module can run them from its own setHeader factory
  // when it takes over the header (opts.skipHeader).
  function applyHeaderHooks(tui: TUI) {
    activeTui = tui;
    requestRender = () => tui.requestRender();
    scheduleThemeRemoval(tui);
  }

  function install(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;

    if (!opts?.skipHeader) {
      ctx.ui.setHeader((tui) => {
        applyHeaderHooks(tui);

        return {
          render(width: number) {
            const line = `  ${CLAUDE_ORANGE}✻ Welcome to Pi${RESET} ${DIM_GRAY}${title}${RESET}`;
            return ["", truncateToWidth(line, width), ""];
          },
          invalidate() {},
        };
      });
    }

    ctx.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
      requestRender = () => tui.requestRender();

      const footer: RenderableNode = {
        invalidate() {},
        render(width: number) {
          const sl = readStatuslineSettings(ctx.cwd);
          const claude = sl.statuslineCtxStyle === "claude";
          const gray = (t: string) => (claude ? `${GRAY}${t}${RESET}` : theme.fg("dim", t));
          const textC = (t: string) => (claude ? `${TEXT}${t}${RESET}` : theme.fg("text", t));
          const accent = (t: string) => (claude ? `${MAUVE}${t}${RESET}` : theme.fg("accent", t));
          const muted = (t: string) => (claude ? `${GRAY}${t}${RESET}` : theme.fg("muted", t));
          const thinkingColored = (level: string) => {
            const key = THINKING_THEME_KEY[level];
            return key ? theme.fg(key, level) : gray(level);
          };

          const diffAdd = (t: string) =>
            claude ? `${GREEN}${t}${RESET}` : theme.fg("success", t);
          const diffDel = (t: string) =>
            claude ? `${RED}${t}${RESET}` : theme.fg("error", t);

          const directory = muted(formatDirectory(ctx.cwd));
          let git = "";
          let diffstat = "";
          if (gitInfo.branch) {
            const statusIcon = gitInfo.hasConflicts
              ? "⚠"
              : gitInfo.changedFiles > 0
                ? "●"
                : "✓";
            let sync = "";
            if (gitInfo.ahead !== null && gitInfo.behind !== null) {
              sync = gitInfo.ahead === 0 && gitInfo.behind === 0 ? " ok" : " !!";
              if (gitInfo.ahead > 0) sync += ` ↑${gitInfo.ahead}`;
              if (gitInfo.behind > 0) sync += ` ↓${gitInfo.behind}`;
            }
            git = `${gitInfo.branch} ${statusIcon}${sync}`;
            if (gitInfo.insertions > 0 || gitInfo.deletions > 0) {
              diffstat = ` ${diffAdd(`+${gitInfo.insertions}`)} ${diffDel(`-${gitInfo.deletions}`)}`;
            }
          }

          if (gitInfo.pullRequest) {
            const prLabel = `PR #${gitInfo.pullRequest.number}`;
            const linkedPr = getCapabilities().hyperlinks
              ? hyperlink(prLabel, gitInfo.pullRequest.url)
              : prLabel;
            git += ` · ${linkedPr}`;
          }

          const percent = Math.round(modelInfo.contextPercent ?? 0);
          const colorContext = contextColor(theme, percent);
          const contextTokens =
            modelInfo.contextTokens === null ? "?" : formatTokens(modelInfo.contextTokens);
          const contextWindow =
            modelInfo.contextWindow > 0 ? formatTokens(modelInfo.contextWindow) : "?";
          const context =
            modelInfo.contextPercent === null
              ? gray("ctx —")
              : claude
                ? (() => {
                    const ramp = ctxRampAnsi(percent);
                    return `${GRAY}ctx ▕${ramp}${smoothBar(percent)}${GRAY}▏ ${ramp}${percent}%${GRAY} · ${contextTokens}/${contextWindow}${RESET}`;
                  })()
                : `${theme.fg("dim", "ctx ▕")}${colorContext(progressBar(percent))}${theme.fg("dim", "▏")} ${colorContext(`${percent}%`)} ${theme.fg("dim", `· ${contextTokens}/${contextWindow}`)}`;
          const tps =
            modelInfo.tokensPerSecond === null
              ? "— tok/s"
              : `${Math.round(modelInfo.tokensPerSecond)} tok/s`;
          const model = modelInfo.provider
            ? `${modelInfo.provider}/${modelInfo.modelId}`
            : modelInfo.modelId;
          const thinking = modelInfo.thinking
            ? ` ${gray("(")}${thinkingColored(modelInfo.thinking)}${gray(")")}`
            : "";
          const cacheHit =
            modelInfo.latestCacheHitRate === null
              ? ""
              : gray(` | CH${modelInfo.latestCacheHitRate.toFixed(1)}%`);
          const usage = `${context} ${gray(`| $${modelInfo.cost.toFixed(2)} | ${tps}`)}${cacheHit}`;

          const statuses = footerData.getExtensionStatuses();
          const selectedStatuses = [
            compactStatus(statuses, "hindsight", "memory", theme),
            compactStatus(statuses, "codex-usage", "codex", theme),
            compactStatus(statuses, "caveman", "caveman", theme, gray),
            (() => {
              const raw = statuses.get("bg-terminals")?.replace(ANSI_PATTERN, "").trim();
              return raw ? `${SKY}${raw}${RESET}` : undefined;
            })(),
            compactStatus(statuses, "mcp", "MCP", theme, gray),
          ].filter((status): status is string => Boolean(status));
          const statusLine = selectedStatuses.join(gray(" | "));

          const separator = gray(" | ");
          const modelAndUsage = `${textC(model)}${thinking}${separator}${usage}`;
          let directoryAndGit = git
            ? `${directory}${separator}${accent(git)}${diffstat}`
            : directory;
          if (sl.statuslineShowWorktree && gitInfo.worktreeName) {
            directoryAndGit += `${separator}${GRAY}wt ${YELLOW}${gitInfo.worktreeName}${RESET}`;
          }
          if (gitInfo.lastCommitTs !== null) {
            directoryAndGit += `${separator}${gray(`cmt ${formatAgo(gitInfo.lastCommitTs)}`)}`;
          }

          return [
            truncateToWidth(modelAndUsage, width, gray("...")),
            truncateToWidth(directoryAndGit, width, gray("...")),
            truncateToWidth(statusLine, width, gray("...")),
          ];
        },
      };

      for (const timer of footerLayoutTimers) clearTimeout(timer);
      footerLayoutTimers = [];
      scheduleFooterAboveFleet(tui, footer, footerLayoutTimers);

      return footer;
    });

    ctx.ui.setTitle(`pi · ${title}`);
    pi.events.emit(REFRESH_CHANNEL, undefined);
  }

  pi.on("session_start", (_event, ctx) => {
    title = formatDirectory(ctx.cwd);
    modelInfo = emptyModelInfoState();
    gitInfo = emptyGitInfoState();
    install(ctx);
  });

  pi.on("resources_discover", () => {
    if (activeTui) scheduleThemeRemoval(activeTui);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stopModelListener();
    stopGitListener();
    for (const timer of themeRemovalTimers) clearTimeout(timer);
    themeRemovalTimers = [];
    for (const timer of footerLayoutTimers) clearTimeout(timer);
    footerLayoutTimers = [];
    activeTui = undefined;
    requestRender = undefined;
    if (ctx.mode === "tui") {
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
    }
  });

  return { onTui: applyHeaderHooks };
}
