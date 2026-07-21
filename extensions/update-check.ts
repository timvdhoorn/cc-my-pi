/**
 * Update check for cc-my-pi (installed as a git clone, not from npm).
 *
 * On session start — at most once per 24h — fetches the package repo's
 * upstream in the background and counts commits HEAD is behind. When behind,
 * shows a one-line notify with the pull + /reload instruction. Everything
 * fails silently (offline, no upstream, not a git checkout).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GIT_TIMEOUT_MS = 15_000;

export interface UpdateCheckState {
	checkedAt?: number;
	behind?: number;
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

export function formatUpdateNotice(behind: number, pkgDir: string): string {
	const commits = behind === 1 ? "1 commit" : `${behind} commits`;
	return `cc-my-pi update available (${commits} behind) — git -C ${pkgDir} pull, then /reload`;
}

/**
 * Package root = the `packages` entry in `~/.pi/agent/settings.json` whose
 * package.json is named cc-my-pi (the install method — a local git clone).
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

function git(args: string[], cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("git", ["-C", cwd, ...args], { timeout: GIT_TIMEOUT_MS }, (err, stdout) => {
			if (err) reject(err);
			else resolve(stdout.trim());
		});
	});
}

/** Fetch upstream and return how many commits HEAD is behind it. Throws on any git failure. */
async function fetchBehindCount(pkgDir: string): Promise<number> {
	await git(["fetch", "--quiet"], pkgDir);
	const out = await git(["rev-list", "--count", "HEAD..@{upstream}"], pkgDir);
	const n = Number.parseInt(out, 10);
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Session-start entry point. Throttled to one git fetch per 24h; a cached
 * "behind" result still notifies each session until the user pulls.
 */
export async function maybeNotifyUpdate(
	notify: (message: string, type?: "info" | "warning" | "error") => void,
	now = Date.now(),
): Promise<void> {
	const pkgDir = packageDir();
	if (!pkgDir) return;
	const state = readUpdateState();
	let behind: number;
	try {
		if (isCheckDue(state, now)) {
			behind = await fetchBehindCount(pkgDir);
			writeUpdateState({ checkedAt: now, behind });
		} else if ((state.behind ?? 0) > 0) {
			// Cached "behind" — recount locally (no fetch) so a pull since the
			// last check clears the notice immediately.
			const out = await git(["rev-list", "--count", "HEAD..@{upstream}"], pkgDir);
			behind = Number.parseInt(out, 10) || 0;
			if (behind !== state.behind) writeUpdateState({ ...state, behind });
		} else {
			return;
		}
	} catch {
		return; // offline / no upstream / not a git checkout — stay quiet
	}
	if (behind > 0) notify(formatUpdateNotice(behind, pkgDir), "info");
}
