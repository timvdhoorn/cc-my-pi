/**
 * Update check for cc-my-pi.
 *
 * On session start — at most once per 24h — fetches the latest published
 * version from the npm registry (falling back to the GitHub package.json
 * while the package is not yet published) and compares it with the installed
 * one. When the remote is newer, shows a one-line notify with the matching
 * update instruction. Everything fails silently (offline, 404, malformed
 * responses, unknown install location).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const NPM_LATEST_URL = "https://registry.npmjs.org/cc-my-pi/latest";
const GITHUB_PACKAGE_JSON_URL =
	"https://raw.githubusercontent.com/timvdhoorn/cc-my-pi/master/package.json";

export interface UpdateCheckState {
	checkedAt?: number;
	/** Latest version seen upstream at the last successful check. */
	latest?: string;
}

function stateFilePath(): string {
	return join(homedir(), ".pi", "cc-my-pi-update-check.json");
}

export function readUpdateState(path = stateFilePath()): UpdateCheckState {
	try {
		if (!existsSync(path)) return {};
		const raw = JSON.parse(readFileSync(path, "utf8"));
		return raw && typeof raw === "object" ? (raw as UpdateCheckState) : {};
	} catch {
		return {};
	}
}

function writeUpdateState(state: UpdateCheckState, path = stateFilePath()): void {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(state) + "\n");
	} catch {
		/* best effort */
	}
}

/** A fresh fetch is due when the last one is older than the check interval. */
export function isCheckDue(state: UpdateCheckState, now: number): boolean {
	return typeof state.checkedAt !== "number" || now - state.checkedAt >= CHECK_INTERVAL_MS;
}

/** True when `remote` is a strictly newer x.y.z than `local`. Non-semver input → false. */
export function isNewerVersion(remote: string, local: string): boolean {
	const parse = (v: string): number[] | undefined => {
		const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
		return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
	};
	const r = parse(remote);
	const l = parse(local);
	if (!r || !l) return false;
	for (let i = 0; i < 3; i++) {
		if (r[i] !== l[i]) return r[i] > l[i];
	}
	return false;
}

export function formatUpdateNotice(latest: string, installed: string, viaNpm: boolean): string {
	const how = viaNpm ? "pi install npm:cc-my-pi" : "update your local copy";
	return `cc-my-pi ${latest} available (installed ${installed}) — ${how}, then /reload`;
}

/**
 * Locate this module's own file via the error stack (import.meta is not
 * available under the CJS typecheck target). Works wherever the package is
 * installed — npm node_modules or a local clone.
 */
function selfModuleDir(): string | undefined {
	const stack = new Error().stack ?? "";
	for (const line of stack.split("\n")) {
		if (!line.includes("update-check")) continue;
		const m = /\(?(?:file:\/\/)?(\/[^):]+update-check[^):]*)/.exec(line);
		if (m) return dirname(m[1]);
	}
	return undefined;
}

/** Installed version, read from the package.json above this module. */
export function installedVersion(moduleDir = selfModuleDir()): string | undefined {
	if (!moduleDir) return undefined;
	// extensions/update-check.ts → package root is one level up.
	for (const dir of [join(moduleDir, ".."), moduleDir]) {
		try {
			const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			if (pkg?.name === "cc-my-pi" && typeof pkg?.version === "string") return pkg.version;
		} catch {
			/* try next */
		}
	}
	return undefined;
}

/** Whether the Pi settings reference the npm install (`npm:cc-my-pi`) vs a local path. */
export function installedViaNpm(settingsPath = join(homedir(), ".pi", "agent", "settings.json")): boolean {
	try {
		const raw = JSON.parse(readFileSync(settingsPath, "utf8"));
		const packages = (raw as { packages?: unknown })?.packages;
		if (!Array.isArray(packages)) return false;
		return packages.some((entry) => {
			const source = typeof entry === "string" ? entry : (entry as { source?: string })?.source;
			return typeof source === "string" && /^npm:cc-my-pi(@|$)/.test(source);
		});
	} catch {
		return false;
	}
}

async function fetchJson(url: string): Promise<unknown> {
	const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

/**
 * Latest published version: npm registry first; GitHub package.json as
 * fallback while the package is not (yet) on npm. Throws when both fail.
 */
async function fetchLatestVersion(): Promise<string> {
	for (const url of [NPM_LATEST_URL, GITHUB_PACKAGE_JSON_URL]) {
		try {
			const v = ((await fetchJson(url)) as { version?: unknown })?.version;
			if (typeof v === "string") return v;
		} catch {
			/* try next source */
		}
	}
	throw new Error("no update source reachable");
}

/**
 * Session-start entry point. Throttled to one registry fetch per 24h; a cached
 * newer "latest" still notifies each session until the install is updated
 * (the installed version is re-read every time, so updating clears it).
 */
export async function maybeNotifyUpdate(
	notify: (message: string, type?: "info" | "warning" | "error") => void,
	now = Date.now(),
): Promise<void> {
	const installed = installedVersion();
	if (!installed) return;
	const state = readUpdateState();
	let latest = state.latest;
	if (isCheckDue(state, now)) {
		try {
			latest = await fetchLatestVersion();
		} catch {
			return; // offline / not published / malformed — stay quiet
		}
		writeUpdateState({ checkedAt: now, latest });
	}
	if (latest && isNewerVersion(latest, installed)) {
		notify(formatUpdateNotice(latest, installed, installedViaNpm()), "info");
	}
}
