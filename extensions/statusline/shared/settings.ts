import { readFileSync } from "node:fs";
import { homedir } from "node:os";

export interface StatuslineSettings {
  statuslineCtxStyle?: "claude" | "plain";
  statuslineShowWorktree?: boolean;
}

const TTL_MS = 5_000;
let cache: { at: number; cwd: string; value: StatuslineSettings } | null = null;

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function readStatuslineSettings(cwd: string): StatuslineSettings {
  const now = Date.now();
  if (cache && cache.cwd === cwd && now - cache.at < TTL_MS) return cache.value;
  const merged = {
    ...readJson(`${homedir()}/.pi/settings.json`),
    ...readJson(`${cwd}/.pi/settings.json`),
  };
  const style = merged.statuslineCtxStyle === "plain" ? "plain" : "claude";
  const value: StatuslineSettings = {
    statuslineCtxStyle: style,
    statuslineShowWorktree: merged.statuslineShowWorktree !== false,
  };
  cache = { at: now, cwd, value };
  return value;
}
