/**
 * Update check for cc-my-pi (installed as a local clone/download, not from npm).
 *
 * On session start — at most once per 24h — fetches the upstream package.json
 * over HTTPS (raw.githubusercontent.com, no git required) and compares its
 * `version` with the installed one. When the remote is newer, shows a one-line
 * notify with the update instruction. Everything fails silently (offline,
 * missing package dir, malformed responses).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const REMOTE_PACKAGE_JSON_URL =
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

export function formatUpdateNotice(latest: string, installed: string, pkgDir: string): string {
	return `cc-my-pi ${latest} available (installed ${installed}) — update your copy in ${pkgDir}, then /reload`;
}

/**
 * Package root = the `packages` entry in `~/.pi/agent/settings.json` whose
 * package.json is named cc-my-pi (the install method — a local clone/download).
 * Returns undefined when not found (e.g. loaded some other way).
 */
export function packageDir(settingsPath = join(homedir(), ".pi", "agent", "settings.json")): string | undefined {
	try {
		const raw = JSON.parse(readFileSync(settingsPath, "utf8"));
		const packages = (raw as { packages?: unknown })?.packages;
		if (!Array.isArray(packages)) return undefined;
		for (const entry of packages) {
			const source = typeof entry === "string" ? entry : (entry as { source?: string })?.source;
			if (typeof source !== "string" || !source.startsWith("/")) continue;
			const pkgJson = join(source, "package.json");
			if (!existsSync(pkgJson)) continue;
			if (JSON.parse(readFileSync(pkgJson, "utf8"))?.name === "cc-my-pi") return source;
		}
	} catch {
		/* fall through */
	}
	return undefined;
}

function installedVersion(pkgDir: string): string | undefined {
	try {
		const v = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"))?.version;
		return typeof v === "string" ? v : undefined;
	} catch {
		return undefined;
	}
}

/** Fetch the upstream package.json version over HTTPS. Throws on any failure. */
async function fetchLatestVersion(url = REMOTE_PACKAGE_JSON_URL): Promise<string> {
	const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const v = ((await res.json()) as { version?: unknown })?.version;
	if (typeof v !== "string") throw new Error("no version field");
	return v;
}

/**
 * Session-start entry point. Throttled to one HTTPS fetch per 24h; a cached
 * newer "latest" still notifies each session until the local copy is updated
 * (the local version is re-read every time, so updating clears it immediately).
 */
export async function maybeNotifyUpdate(
	notify: (message: string, type?: "info" | "warning" | "error") => void,
	now = Date.now(),
): Promise<void> {
	const pkgDir = packageDir();
	if (!pkgDir) return;
	const installed = installedVersion(pkgDir);
	if (!installed) return;
	const state = readUpdateState();
	let latest = state.latest;
	if (isCheckDue(state, now)) {
		try {
			latest = await fetchLatestVersion();
		} catch {
			return; // offline / rate-limited / malformed — stay quiet
		}
		writeUpdateState({ checkedAt: now, latest });
	}
	if (latest && isNewerVersion(latest, installed)) {
		notify(formatUpdateNotice(latest, installed, pkgDir), "info");
	}
}
