/**
 * Reader/writer for the native `quietStartup` key in Pi core's OWN settings file
 * (`~/.pi/agent/settings.json`) — a DIFFERENT file from cc-my-pi's own
 * `~/.pi/settings.json`. When `quietStartup` is true, Pi core suppresses its
 * startup resource listing (the `/loaded` command shows it on demand instead).
 *
 * Writes preserve every other key and Pi core's file style (2-space indent,
 * trailing newline); on a parse failure the file is never clobbered.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface QuietStartupFile {
	/** Current value; missing file/key → false. */
	read(): boolean;
	/** Set `quietStartup`, preserving all other keys. Best-effort; never throws. */
	write(value: boolean): void;
}

function defaultSettingsPath(): string {
	return join(homedir(), ".pi", "agent", "settings.json");
}

/**
 * `settingsPath` exists so tests point at a temp file; production uses the
 * `~/.pi/agent/settings.json` default.
 */
export function createQuietStartupFile(settingsPath: string = defaultSettingsPath()): QuietStartupFile {
	return {
		read(): boolean {
			try {
				const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as { quietStartup?: unknown };
				return parsed?.quietStartup === true;
			} catch {
				return false;
			}
		},
		write(value: boolean): void {
			let settings: Record<string, unknown> = {};
			if (existsSync(settingsPath)) {
				try {
					const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
					if (parsed && typeof parsed === "object") settings = parsed as Record<string, unknown>;
					else return; // non-object JSON → refuse to clobber
				} catch {
					return; // unparseable → never clobber a file we couldn't read
				}
			}
			settings.quietStartup = value;
			try {
				mkdirSync(dirname(settingsPath), { recursive: true });
				writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
			} catch {
				// best effort
			}
		},
	};
}
