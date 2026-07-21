/**
 * Optional companion packages for cc-my-pi: a static, list-driven catalog plus a
 * tiny reader/writer for Pi's global `~/.pi/agent/settings.json` packages array.
 *
 * The panel and the setup wizard render one row per companion (with ✓/✗ install
 * state) and can install a single package on demand. Installing shells out to
 * the real `pi install <source>` CLI (which fetches/caches the npm package and
 * records it in settings.json); Pi picks the package up on the next `/reload`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CompanionPackage {
	name: string; // "pi-context-view"
	source: string; // "npm:pi-context-view"
	blurb: string; // one line for the wizard row
}

export const COMPANION_PACKAGES: CompanionPackage[] = [
	{ name: "pi-context-view", source: "npm:pi-context-view", blurb: "Visualize context usage & inspect hidden injections" },
	{ name: "pi-mcp-adapter", source: "npm:pi-mcp-adapter", blurb: "Use MCP servers (tools) inside Pi" },
	{ name: "pi-subagents", source: "npm:pi-subagents", blurb: "Delegate tasks to subagents (chains, parallel)" },
	{ name: "pi-dynamic-workflows", source: "npm:@quintinshaw/pi-dynamic-workflows", blurb: "Fan tasks out across subagents (/workflows, /deep-research)" },
	{ name: "pi-tasks", source: "npm:@tintinweb/pi-tasks", blurb: "Claude Code-style task tracking and coordination" },
	{ name: "rpiv-ask-user-question", source: "npm:@juicesharp/rpiv-ask-user-question", blurb: "Structured questions with typed options instead of guessing" },
];

export interface PackagesFile {
	isInstalled(source: string): boolean;
	/** Install `source` via the `pi install` CLI. Throws on failure. */
	install(source: string): void;
}

/** Shell out to `pi install <source>`; throw a descriptive error on failure. */
function spawnPiInstall(source: string): void {
	const result = spawnSync("pi", ["install", source], { stdio: "ignore", timeout: 120_000 });
	if (result.error) {
		throw new Error(`pi install ${source} failed: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`pi install ${source} exited with status ${result.status ?? "unknown"}`);
	}
}

/** A packages entry is either a plain string or an object with a `source`. */
function entrySource(entry: unknown): string | undefined {
	if (typeof entry === "string") return entry;
	if (entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string") {
		return (entry as { source: string }).source;
	}
	return undefined;
}

function defaultSettingsPath(): string {
	return join(homedir(), ".pi", "agent", "settings.json");
}

/**
 * Reader/writer for the Pi global settings `packages` array. `settingsPath`
 * exists so tests point at a temp file; production uses the homedir default.
 */
export function createPiPackagesFile(
	settingsPath: string = defaultSettingsPath(),
	runInstall: (source: string) => void = spawnPiInstall,
): PackagesFile {
	return {
		isInstalled(source: string): boolean {
			let settings: unknown;
			try {
				settings = JSON.parse(readFileSync(settingsPath, "utf8"));
			} catch {
				// Missing file / parse error → treat as not installed, never throw.
				return false;
			}
			const packages = (settings as { packages?: unknown })?.packages;
			if (!Array.isArray(packages)) return false;
			return packages.some((entry) => entrySource(entry) === source);
		},
		install(source: string): void {
			// Delegate to the Pi CLI, which fetches/caches the package and records
			// it in settings.json. Errors propagate for the caller to notify.
			runInstall(source);
		},
	};
}
