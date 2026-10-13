import assert from "node:assert/strict";
import test, { beforeEach, type TestContext } from "node:test";
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

/** Test-local timer controls keep abandoned callbacks available after cancellation. */
function deferredClock(t: TestContext) {
	const timers: Array<{ callback: () => void; cleared: boolean; unref(): void }> = [];
	t.mock.method(globalThis, "setTimeout", (callback: () => void) => {
		const timer = { callback, cleared: false, unref() {} };
		timers.push(timer);
		return timer;
	});
	t.mock.method(globalThis, "clearTimeout", (timer: (typeof timers)[number]) => {
		timer.cleared = true;
	});
	return timers;
}

function staleableCtx() {
	const result = makeCtx();
	let stale = false;
	let modeReads = 0;
	Object.defineProperty(result.ctx, "mode", {
		get() {
			modeReads++;
			if (stale) throw new Error("This extension ctx is stale after session replacement or reload.");
			return "tui";
		},
	});
	return { ...result, invalidate: () => { stale = true; }, reads: () => modeReads };
}

for (const reason of ["quit", "new", "resume", "fork", "reload"]) {
	test(`shutdown (${reason}) cancels installation before touching an invalidated ctx`, (t) => {
		const timers = deferredClock(t);
		const { pi, handlers } = makePi();
		let hooks = 0;
		registerClaudeHeader(pi, true, { onTui: () => { hooks++; } });
		const old = staleableCtx();
		handlers.get("session_start")!({}, old.ctx);
		assert.equal(timers.length, 1);
		handlers.get("session_shutdown")!({ reason }, old.ctx);
		handlers.get("session_shutdown")!({ reason }, old.ctx);
		old.invalidate();
		const readsBefore = old.reads();
		assert.equal(timers[0].cleared, true);
		assert.doesNotThrow(() => timers[0].callback());
		assert.equal(old.reads(), readsBefore, "abandoned callback never probes stale context");
		assert.equal(old.setHeaderFactories.length, 0);
		assert.equal(hooks, 0);
	});
}

for (const shutdown of [false, true]) {
	test(`new start supersedes pending work (shutdown=${shutdown})`, (t) => {
		const timers = deferredClock(t);
		const { pi, handlers } = makePi();
		registerClaudeHeader(pi, true);
		const old = staleableCtx();
		const fresh = makeCtx();
		handlers.get("session_start")!({}, old.ctx);
		if (shutdown) handlers.get("session_shutdown")!({ reason: "new" }, old.ctx);
		handlers.get("session_start")!({}, fresh.ctx);
		old.invalidate();
		assert.equal(timers[0].cleared, true);
		assert.doesNotThrow(() => timers[0].callback());
		timers[1].callback();
		assert.equal(old.setHeaderFactories.length, 0);
		assert.equal(fresh.setHeaderFactories.length, 1);
	});
}

test("reload isolates old and new registrations, without cancelling unrelated timers", (t) => {
	const timers = deferredClock(t);
	const oldPi = makePi();
	const newPi = makePi();
	registerClaudeHeader(oldPi.pi, true);
	const old = staleableCtx();
	oldPi.handlers.get("session_start")!({}, old.ctx);
	let unrelatedRan = false;
	setTimeout(() => { unrelatedRan = true; }, 0);
	oldPi.handlers.get("session_shutdown")!({ reason: "reload" }, old.ctx);
	old.invalidate();
	registerClaudeHeader(newPi.pi, true);
	const fresh = makeCtx();
	newPi.handlers.get("session_start")!({}, fresh.ctx);
	assert.deepEqual(timers.map((timer) => timer.cleared), [true, false, false]);
	for (const timer of timers) timer.callback();
	assert.equal(unrelatedRan, true);
	assert.equal(old.setHeaderFactories.length, 0);
	assert.equal(fresh.setHeaderFactories.length, 1);
});

test("healthy TUI installs after synchronous startup handlers and preserves onTui", (t) => {
	const timers = deferredClock(t);
	const { pi, handlers } = makePi();
	const order: string[] = [];
	const tui = { requestRender() {} };
	registerClaudeHeader(pi, true, { onTui: (actual) => {
		assert.equal(actual, tui);
		order.push("hook");
	} });
	const { ctx, setHeaderFactories } = makeCtx();
	handlers.get("session_start")!({}, ctx);
	order.push("later startup handler");
	assert.equal(setHeaderFactories.length, 0);
	timers[0].callback();
	order.push("header installed");
	const component = setHeaderFactories[0](tui);
	assert.deepEqual(order, ["later startup handler", "header installed", "hook"]);
	handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
	component.dispose();
});

for (const mode of ["print", "json", "rpc"]) {
	test(`healthy ${mode} startup schedules no header work`, (t) => {
		const timers = deferredClock(t);
		const { pi, handlers } = makePi();
		registerClaudeHeader(pi, true, { onTui() { assert.fail("non-TUI hook"); } });
		const { ctx, setHeaderFactories } = makeCtx();
		ctx.mode = mode;
		handlers.get("session_start")!({}, ctx);
		handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
		assert.equal(timers.length, 0);
		assert.equal(setHeaderFactories.length, 0);
	});
}

test("unexpected live mode, setHeader and hook failures remain visible", (t) => {
	const timers = deferredClock(t);
	const { pi, handlers } = makePi();
	const failure = new Error("unexpected live failure");
	registerClaudeHeader(pi, true, { onTui() { throw failure; } });
	const brokenMode = makeCtx();
	Object.defineProperty(brokenMode.ctx, "mode", { get() { throw failure; } });
	assert.throws(() => handlers.get("session_start")!({}, brokenMode.ctx), (error) => error === failure);
	const brokenUi = makeCtx();
	brokenUi.ctx.ui.setHeader = () => { throw failure; };
	handlers.get("session_start")!({}, brokenUi.ctx);
	assert.throws(() => timers[0].callback(), (error) => error === failure);
	const brokenHook = makeCtx();
	handlers.get("session_start")!({}, brokenHook.ctx);
	timers[1].callback();
	assert.throws(() => brokenHook.setHeaderFactories[0]({ requestRender() {} }), (error) => error === failure);
	handlers.get("session_shutdown")!({ reason: "quit" }, brokenHook.ctx);
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
