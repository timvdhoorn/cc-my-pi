/**
 * /copy command — Claude Code-style "select content to copy" picker.
 *
 * Own code (not vendored): built from the public Pi extension API only. The
 * owner's private `copy-all` extension (third party, unlicensed) is NOT a
 * source — this copies the LAST assistant response (or one of its fenced code
 * blocks) rather than the whole thread, and shares no code with it.
 *
 * Registration-time gate (`copyCommandEnabled`, default on): the command
 * cannot be unregistered live, so toggling requires /reload — same contract
 * as `sessionCommandsEnabled` and `spinnerEnabled`. The `copyAlwaysFull`
 * preference (skip the picker) is read live on each invocation, no reload.
 */
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface CopyDeps {
	copyToClipboard?: (text: string) => Promise<void>;
}

/** Flatten assistant message content to text (string as-is; array joins text blocks). */
export function extractAssistantText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: "text"; text: string } =>
				!!block &&
				typeof block === "object" &&
				(block as { type?: unknown }).type === "text" &&
				typeof (block as { text?: unknown }).text === "string",
		)
		.map((block) => block.text)
		.join("\n");
}

/** Parse fenced code blocks. Unclosed fences are ignored; lang may be empty. */
export function extractCodeBlocks(text: string): { lang: string; code: string }[] {
	const blocks: { lang: string; code: string }[] = [];
	const re = /^```([^\n`]*)\n([\s\S]*?)^```\s*$/gm;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		blocks.push({
			lang: match[1].trim(),
			code: match[2].replace(/\n$/, ""),
		});
	}
	return blocks;
}

/** Build the unique, numbered picker option strings (order: full, blocks…, always-full). */
export function buildPickerOptions(
	fullText: string,
	blocks: { lang: string; code: string }[],
): string[] {
	const chars = fullText.length;
	const lines = fullText.split("\n").length;
	const options: string[] = [`1. Full response  (${chars} chars, ${lines} lines)`];
	blocks.forEach((block, idx) => {
		const firstLine = block.code.split("\n").find((line) => line.trim() !== "") ?? "";
		const label = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
		options.push(`${idx + 2}. ${label}  [${block.lang || "text"}]`);
	});
	options.push(
		`${blocks.length + 2}. Always copy full response  (skip this picker; revert via /cc-my-pi settings)`,
	);
	return options;
}

/** Spawn a copy binary, pipe text to stdin, resolve on exit 0. */
function spawnCopy(cmd: string, args: string[], text: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args);
		let stderr = "";
		child.on("error", reject);
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
		});
		child.stdin?.end(text);
	});
}

/** Platform default clipboard writer (no external deps). */
function defaultCopyToClipboard(text: string): Promise<void> {
	if (process.platform === "darwin") return spawnCopy("pbcopy", [], text);
	if (process.platform === "win32") return spawnCopy("clip", [], text);
	return spawnCopy("wl-copy", [], text).catch(() =>
		spawnCopy("xclip", ["-selection", "clipboard"], text),
	);
}

export function registerCopyCommand(
	pi: ExtensionAPI,
	enabled: boolean,
	settings: { copyAlwaysFull: () => boolean; setCopyAlwaysFull: (v: boolean) => void },
	deps?: CopyDeps,
): void {
	if (!enabled) return;

	const copyToClipboard = deps?.copyToClipboard ?? defaultCopyToClipboard;

	pi.registerCommand("copy", {
		description: "Copy the last response (or one of its code blocks) to the clipboard",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			const branch = ctx.sessionManager.getBranch();
			let lastAssistant: unknown;
			for (const entry of branch) {
				if (entry.type !== "message") continue;
				const message = (entry as { message?: { role?: string; content?: unknown } }).message;
				if (message?.role === "assistant") lastAssistant = message.content;
			}

			const text = extractAssistantText(lastAssistant).trim();
			if (!text) {
				ctx.ui.notify("No assistant response to copy", "info");
				return;
			}

			const copy = async (payload: string, successMsg: string) => {
				try {
					await copyToClipboard(payload);
					ctx.ui.notify(successMsg, "info");
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					ctx.ui.notify(`Copy failed: ${msg}`, "error");
				}
			};

			const blocks = extractCodeBlocks(text);

			if (settings.copyAlwaysFull() || blocks.length === 0 || !ctx.hasUI) {
				await copy(text, `Copied full response (${text.length} chars)`);
				return;
			}

			const options = buildPickerOptions(text, blocks);
			const choice = await ctx.ui.select("Select content to copy", options);
			if (choice === undefined) return; // cancelled

			const index = options.indexOf(choice);
			if (index === 0) {
				await copy(text, `Copied to clipboard (${text.length} chars)`);
			} else if (index === options.length - 1) {
				settings.setCopyAlwaysFull(true);
				await copy(text, "Copied full response — picker disabled (revert via /cc-my-pi settings)");
			} else {
				const block = blocks[index - 1];
				await copy(block.code, `Copied to clipboard (${block.code.length} chars)`);
			}
		},
	});
}
