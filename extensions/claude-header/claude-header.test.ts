import assert from "node:assert/strict";
import test from "node:test";
import { registerClaudeHeader } from "./index.ts";
import { headerColumnWidths, padRight, pickSlashCommandTips } from "./render-utils.ts";

const stubTheme: any = {
	fg: (_key: string, text: string) => text,
	bold: (text: string) => text,
};

/** Minimal fake pi that records `on` handlers and serves commands/thinking. */
function makePi() {
	const handlers = new Map<string, (event: any, ctx: any) => void>();
	const pi: any = {
		on: (event: string, handler: (event: any, ctx: any) => void) => {
			handlers.set(event, handler);
		},
		getCommands: () => [{ name: "model" }, { name: "settings" }, { name: "reload" }],
		getThinkingLevel: () => "medium",
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
	const lines = component.render(80);
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

test("tips include /cc-my-pi and never the upstream use-default-tui command", async () => {
	const { pi, handlers } = makePi();
	registerClaudeHeader(pi, true);
	const { ctx, setHeaderFactories } = makeCtx();

	handlers.get("session_start")!({}, ctx);
	await tick();

	const component = setHeaderFactories[0]!({ requestRender: () => {} });
	const rendered = component.render(80).join("\n");
	assert.ok(rendered.includes("/cc-my-pi"), "fixed tip present");
	assert.ok(!rendered.includes("use-default-tui"), "no upstream command name leaks in");
	component.dispose();
});

test("headerColumnWidths hides tips when the terminal is too narrow", () => {
	const narrow = headerColumnWidths(20);
	assert.equal(narrow.useTips, false);
	assert.equal(narrow.leftWidth, 20);

	const wide = headerColumnWidths(100);
	assert.equal(wide.useTips, true);
	assert.ok(wide.leftWidth > wide.rightWidth, "logo half stays wider than tips");
});

test("padRight pads to width and truncates with an ellipsis when over", () => {
	assert.equal(padRight("hi", 5), "hi   ");
	const clipped = padRight("hello world", 5, "…");
	assert.ok(clipped.startsWith("hell"), "keeps the leading visible chars");
	assert.ok(clipped.includes("…"), "adds the ellipsis when truncating");
});

test("pickSlashCommandTips puts the fixed tip first, slash-prefixed", () => {
	const tips = pickSlashCommandTips(["model", "settings", "reload"], {
		fixed: ["cc-my-pi"],
		count: 2,
		random: () => 0,
	});
	assert.equal(tips[0], "/cc-my-pi");
	assert.equal(tips.length, 3);
});

test("pickSlashCommandTips respects count and never duplicates", () => {
	const tips = pickSlashCommandTips(["model", "model", "settings", "reload", "quit"], {
		fixed: ["cc-my-pi"],
		count: 3,
		random: () => 0.5,
	});
	assert.equal(tips.length, 4);
	assert.equal(new Set(tips).size, tips.length, "no duplicate tips");
	assert.ok(tips.every((t) => t.startsWith("/")), "all tips slash-prefixed");
});

test("pickSlashCommandTips excludes the fixed name from the random pool", () => {
	const tips = pickSlashCommandTips(["cc-my-pi", "model", "settings"], {
		fixed: ["cc-my-pi"],
		count: 3,
		random: () => 0,
	});
	assert.equal(tips.filter((t) => t === "/cc-my-pi").length, 1, "fixed name not re-picked");
});
