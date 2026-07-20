/**
 * /exit and /clear session commands.
 *
 * Own code (not vendored): moved in from the owner's personal Pi config
 * (`~/.pi/agent/extensions/exit-command.ts` + `clear-as-new.ts`, 2026-07-20).
 * /clear replaces the npm package `pi-clear` (which also reloaded the runtime).
 *
 * Registration-time gate (`sessionCommandsEnabled`, default on): commands
 * cannot be unregistered live, so toggling requires /reload — same contract
 * as `imagePasterEnabled` and `spinnerEnabled`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerSessionCommands(pi: ExtensionAPI, enabled: boolean): void {
	if (!enabled) return;

	pi.registerCommand("exit", {
		description: "Exit pi cleanly",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});

	pi.registerCommand("clear", {
		description: "Start a new session (same as /new)",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			const result = await ctx.newSession();
			if (result.cancelled) {
				ctx.ui.notify("New session cancelled", "warning");
			}
		},
	});
}
