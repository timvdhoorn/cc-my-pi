import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
			const sourceUrl = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
			if (existsSync(fileURLToPath(sourceUrl))) {
				return { url: sourceUrl.href, shortCircuit: true };
			}
		}
		return nextResolve(specifier, context);
	},
});

const {
	applyThinkingBlockMetadata,
	hasNonEmptyAssistantTextDelta,
	registerShiftEnterNewlineWrapper,
	registerThinkingLabels,
	trackThinkingBlockEvents,
} = await import("./index.ts");

test("recognizes only non-empty v0.84 text deltas", () => {
	assert.equal(hasNonEmptyAssistantTextDelta({ assistantMessageEvent: { type: "text_delta", delta: "hello" } }), true);
	assert.equal(hasNonEmptyAssistantTextDelta({ assistantMessageEvent: { type: "text_delta", delta: "  " } }), false);
	assert.equal(hasNonEmptyAssistantTextDelta({ assistantMessageEvent: { type: "thinking_delta", delta: "hello" } }), false);
	assert.equal(hasNonEmptyAssistantTextDelta({}), false);
});

test("tracks delta-only thinking events and finalizes authoritative message metadata", () => {
	const renders: string[] = [];
	const ctx = {
		ui: {
			invalidate: () => renders.push("invalidate"),
			requestRender: () => renders.push("render"),
		},
	};

	trackThinkingBlockEvents({ assistantMessageEvent: { type: "thinking_start" } }, ctx, 1_000);
	trackThinkingBlockEvents({ assistantMessageEvent: { type: "thinking_end" } }, ctx, 1_250);
	const message: Record<string, unknown> = {
		role: "assistant",
		_piClaudeStyleThinkingActive: true,
	};
	applyThinkingBlockMetadata(message);

	assert.equal(message._piClaudeStyleThinkingDurationMs, 250);
	assert.equal("_piClaudeStyleThinkingActive" in message, false);
	assert.deepEqual(renders, ["invalidate", "render", "invalidate", "render"]);
});

test("message handlers accept delta-only thinking updates and patch full message on message_end", async () => {
	const handlers = new Map<string, (event: any, ctx: any) => unknown>();
	const pi = {
		on: (name: string, handler: (event: any, ctx: any) => unknown) => handlers.set(name, handler),
	} as unknown as ExtensionAPI;
	registerThinkingLabels(pi);

	const originalNow = Date.now;
	let now = 2_000;
	Date.now = () => now;
	try {
		const ctx = { ui: { theme: undefined, invalidate() {}, requestRender() {} } };
		await handlers.get("message_update")?.(
			{ assistantMessageEvent: { type: "thinking_start" } },
			ctx,
		);
		now = 2_200;
		await handlers.get("message_update")?.(
			{ assistantMessageEvent: { type: "thinking_end" } },
			ctx,
		);
		const message = {
			role: "assistant",
			content: [{ type: "thinking", thinking: "analysis" }],
			stopReason: "toolUse",
		};
		await handlers.get("message_end")?.({ message }, ctx);
		assert.equal((message as any)._piClaudeStyleThinkingDurationMs, 200);
		assert.equal(message.content[0]?.thinking, "Thinking: analysis");
	} finally {
		Date.now = originalNow;
	}
});

test("replacement extension invalidates pending editor installs from stale contexts", () => {
	const oldHandlers = new Map<string, (event: any, ctx: any) => unknown>();
	const replacementHandlers = new Map<string, (event: any, ctx: any) => unknown>();
	const scheduledTimers: Array<{ callback: () => void; cleared: boolean }> = [];
	const scheduledMicrotasks: Array<() => void> = [];
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	const originalQueueMicrotask = globalThis.queueMicrotask;

	globalThis.setTimeout = ((callback: () => void) => {
		const timer = { callback, cleared: false };
		scheduledTimers.push(timer);
		return timer as any;
	}) as typeof setTimeout;
	globalThis.clearTimeout = ((timer: any) => {
		timer.cleared = true;
	}) as typeof clearTimeout;
	globalThis.queueMicrotask = ((callback: () => void) => {
		scheduledMicrotasks.push(callback);
	}) as typeof queueMicrotask;

	try {
		const oldPi = {
			on: (name: string, handler: (event: any, ctx: any) => unknown) => oldHandlers.set(name, handler),
		} as unknown as ExtensionAPI;
		registerShiftEnterNewlineWrapper(oldPi);

		let oldContextStale = false;
		const makeContext = (isStale: () => boolean) => ({
			mode: "tui",
			ui: {
				getEditorComponent() {
					if (isStale()) throw new Error("stale extension ctx");
					return undefined;
				},
				setEditorComponent() {
					if (isStale()) throw new Error("stale extension ctx");
				},
			},
		});

		oldHandlers.get("session_start")?.({}, makeContext(() => oldContextStale));
		const staleTimers = [...scheduledTimers];
		const staleMicrotasks = [...scheduledMicrotasks];
		oldContextStale = true;

		const replacementPi = {
			on: (name: string, handler: (event: any, ctx: any) => unknown) => replacementHandlers.set(name, handler),
		} as unknown as ExtensionAPI;
		registerShiftEnterNewlineWrapper(replacementPi);
		replacementHandlers.get("session_start")?.({}, makeContext(() => false));

		assert.doesNotThrow(() => {
			for (const callback of staleMicrotasks) callback();
			for (const timer of staleTimers) timer.callback();
		});
		assert.equal(staleTimers.every((timer) => timer.cleared), false);
		assert.deepEqual([...oldHandlers.keys()], ["session_start", "agent_start"]);
		assert.deepEqual([...replacementHandlers.keys()], ["session_start", "agent_start"]);
	} finally {
		globalThis.setTimeout = originalSetTimeout;
		globalThis.clearTimeout = originalClearTimeout;
		globalThis.queueMicrotask = originalQueueMicrotask;
	}
});
