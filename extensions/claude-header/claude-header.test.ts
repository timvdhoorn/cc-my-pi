import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { registerClaudeHeader } from "./index.ts";
import { headerColumnWidths, padRight } from "./render-utils.ts";
import { collectLoadedStats, resetLoadedStatsCache } from "./loaded-stats.ts";

/**
 * Pre-seed the shared stats cache with a stub loader so the header never builds
 * a real DefaultResourceLoader (keeps these tests off the real ~/.pi/agent).
 */
function seedStats(): void {
	resetLoadedStatsCache();
	collectLoadedStats("/t", "/t", false, {
		loaderFactory: () => ({
			reload: async () => {},
			getSkills: () => ({ skills: [] }),
			getPrompts: () => ({ prompts: [] }),
			getExtensions: () => ({ extensions: [] }),
			getThemes: () => ({ themes: [] }),
		}),
	});
}

beforeEach(seedStats);

const stubTheme: any = {
	fg: (_key: string, text: string) => text,
	bold: (text: string) => text,
};

/** Minimal fake pi that records `on` handlers and serves commands/thinking. */
function makePi(commands: Array<{ name: string }> = [{ name: "model" }, { name: "settings" }]) {
	const handlers = new Map<string, (event: any, ctx: any) => void>();
	const pi: any = {
		on: (event: string, handler: (event: any, ctx: any) => void) => {
			handlers.set(event, handler);
		},
		getCommands: () => commands,
		getThinkingLevel: () => "medium",
		sendMessage: () => {},
	};
	return { pi, handlers };
}

/** Fake tui context; captures the setHeader factory. */
function makeCtx() {
	const setHeaderFactories: Array<(tui: any) => any> = [];
	const ctx: any = {
		mode: "tui",
		cwd: "/home/user/project",
		model: { provider: "anthropic", id: "claude-x" },
		ui: {
			theme: stubTheme,
			setHeader: (factory: (tui: any) => any) => setHeaderFactories.push(factory),
		},
	};
	return { ctx, setHeaderFactories };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const FAKE_STATS = {
	skills: { user: 128, project: 14 },
	prompts: { user: 15, project: 2 },
	extensions: { user: 30, project: 8 },
	themes: { user: 4, project: 1 },
	mcpServers: 3,
	detail: {
		skills: { global: [], project: [] },
		prompts: { global: [], project: [] },
		extensions: { global: [], project: [] },
		themes: { global: [], project: [] },
		mcp: { global: [], project: [] },
	},
};

test("registerClaudeHeader(pi, false) registers no handlers and never sets a header", async () => {
	const { pi, handlers } = makePi();
	registerClaudeHeader(pi, false);
	assert.equal(handlers.size, 0);
});

test("enabled: session_start sets a header whose first line is the boxed frame", async () => {
	const { pi, handlers } = makePi();
	registerClaudeHeader(pi, true);
	const { ctx, setHeaderFactories } = makeCtx();

	handlers.get("session_start")!({}, ctx);
	await tick();

	assert.equal(setHeaderFactories.length, 1);
	const component = setHeaderFactories[0]!({ requestRender: () => {} });
	const lines = component.render(120);
	assert.ok(lines[0].includes("╭"), "first line has top-left box corner");
	assert.ok(lines[0].includes("Pi v"), "first line labels the Pi version");
	component.dispose();
});

test("onTui hook is invoked with the tui from the setHeader factory", async () => {
	const { pi, handlers } = makePi();
	let hookTui: any;
	registerClaudeHeader(pi, true, { onTui: (tui) => (hookTui = tui) });
	const { ctx, setHeaderFactories } = makeCtx();

	handlers.get("session_start")!({}, ctx);
	await tick();

	const tui = { requestRender: () => {} };
	const component = setHeaderFactories[0]!(tui);
	assert.equal(hookTui, tui);
	component.dispose();
});

test("dispose() clears the animation interval timer", async () => {
	const { pi, handlers } = makePi();
	registerClaudeHeader(pi, true);
	const { ctx, setHeaderFactories } = makeCtx();

	handlers.get("session_start")!({}, ctx);
	await tick();

	const cleared: unknown[] = [];
	const origSet = globalThis.setInterval;
	const origClear = globalThis.clearInterval;
	const fakeTimer: any = { unref: () => {}, __tag: "header-timer" };
	(globalThis as any).setInterval = () => fakeTimer;
	(globalThis as any).clearInterval = (t: unknown) => cleared.push(t);
	try {
		const component = setHeaderFactories[0]!({ requestRender: () => {} });
		component.dispose();
	} finally {
		globalThis.setInterval = origSet;
		globalThis.clearInterval = origClear;
	}
	assert.ok(cleared.includes(fakeTimer), "dispose passed the interval handle to clearInterval");
});

test("right column shows the Getting started + Loaded sections and the /loaded hint", async () => {
	const { pi, handlers } = makePi();
	registerClaudeHeader(pi, true);
	const { ctx, setHeaderFactories } = makeCtx();

	handlers.get("session_start")!({}, ctx);
	await tick();

	const component = setHeaderFactories[0]!({ requestRender: () => {} });
	const rendered = component.render(120).join("\n");
	assert.ok(rendered.includes("Getting started"), "getting-started section header");
	assert.ok(rendered.includes("Run /cc-my-pi to configure the look"), "single tip line");
	assert.ok(rendered.includes("Loaded"), "loaded section header");
	assert.ok(rendered.includes("/loaded for details"), "loaded hint");
	assert.ok(rendered.includes("cc-my-pi"), "left-column tagline present");
	component.dispose();
});

test("counts line shows … while stats are pending, then real counts once resolved", async () => {
	const { pi, handlers } = makePi();
	registerClaudeHeader(pi, true);
	const { ctx, setHeaderFactories } = makeCtx();

	handlers.get("session_start")!({}, ctx);
	await tick();

	const component = setHeaderFactories[0]!({ requestRender: () => {} });
	// Synchronous first render: the async scan has not resolved → placeholder.
	assert.ok(component.render(120).join("\n").includes("…"), "pending placeholder");

	(component as any).stats = FAKE_STATS;
	const resolved = component.render(120).join("\n");
	assert.ok(resolved.includes("142 skills · 17 prompts · 38 extensions · 3 mcp servers"), "counts line");
	assert.ok(resolved.includes("173 global · 24 project"), "aggregate excludes themes and mcp");
	component.dispose();
});

test("/context hint appears only when a context command exists", async () => {
	// Absent.
	{
		const { pi, handlers } = makePi([{ name: "model" }]);
		registerClaudeHeader(pi, true);
		const { ctx, setHeaderFactories } = makeCtx();
		handlers.get("session_start")!({}, ctx);
		await tick();
		const component = setHeaderFactories[0]!({ requestRender: () => {} });
		assert.ok(!component.render(120).join("\n").includes("/context"), "no /context hint");
		component.dispose();
	}
	// Present.
	{
		const { pi, handlers } = makePi([{ name: "model" }, { name: "context" }]);
		registerClaudeHeader(pi, true);
		const { ctx, setHeaderFactories } = makeCtx();
		handlers.get("session_start")!({}, ctx);
		await tick();
		const component = setHeaderFactories[0]!({ requestRender: () => {} });
		assert.ok(
			component.render(120).join("\n").includes("/context to view current context"),
			"context hint present",
		);
		component.dispose();
	}
});

test("headerColumnWidths flips to Claude proportions (narrow left, wider right)", () => {
	const narrow = headerColumnWidths(20);
	assert.equal(narrow.useRight, false);
	assert.equal(narrow.leftWidth, 20);

	const wide = headerColumnWidths(120);
	assert.equal(wide.useRight, true);
	assert.ok(wide.rightWidth > wide.leftWidth, "right column is the wider half");
	assert.ok(wide.leftWidth <= 44, "left column clamped to MAX_LEFT_WIDTH");
	assert.ok(wide.leftWidth >= 24, "left column at least MIN_LEFT_WIDTH");
});

test("padRight pads to width and truncates with an ellipsis when over", () => {
	assert.equal(padRight("hi", 5), "hi   ");
	const clipped = padRight("hello world", 5, "…");
	assert.ok(clipped.startsWith("hell"), "keeps the leading visible chars");
	assert.ok(clipped.includes("…"), "adds the ellipsis when truncating");
});
