import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	collectLoadedStats,
	registerLoadedCommand,
	renderLoadedMessage,
	resetLoadedStatsCache,
	type LoaderFactory,
} from "./loaded-stats.ts";

type Item = { name?: string; path?: string; source?: string; scope?: string };

function makeStubLoader(items: {
	skills?: Item[];
	prompts?: Item[];
	extensions?: Item[];
	themes?: Item[];
}): LoaderFactory {
	const wrap = (arr: Item[] = []) =>
		arr.map((i) => ({
			name: i.name,
			path: i.path,
			sourceInfo: { scope: i.scope, source: i.source },
		}));
	return () => ({
		reload: async () => {},
		getSkills: () => ({ skills: wrap(items.skills) }),
		getPrompts: () => ({ prompts: wrap(items.prompts) }),
		getExtensions: () => ({ extensions: wrap(items.extensions) }),
		getThemes: () => ({ themes: wrap(items.themes) }),
	});
}

test("buckets skills/prompts/extensions/themes by scope (temporary/missing → global)", async () => {
	resetLoadedStatsCache();
	const stats = await collectLoadedStats("/cwd", "/agent", false, {
		loaderFactory: makeStubLoader({
			skills: [
				{ name: "a", scope: "user" },
				{ name: "b", scope: "project" },
				{ name: "c", scope: "temporary" },
				{ name: "d" }, // missing scope
			],
			prompts: [{ name: "p1", scope: "project" }],
			extensions: [
				{ source: "npm:pi-context-view", scope: "user" },
				{ path: "/x/y/local-ext/index.ts", source: "local", scope: "project" },
			],
			themes: [{ name: "cc-my-pi-dark", scope: "user" }],
		}),
	});

	assert.deepEqual(stats.skills, { user: 3, project: 1 }, "temporary + missing count as global");
	assert.deepEqual(stats.detail.skills.global, ["a", "c", "d"]);
	assert.deepEqual(stats.detail.skills.project, ["b"]);
	assert.deepEqual(stats.prompts, { user: 0, project: 1 });
	assert.deepEqual(stats.extensions, { user: 1, project: 1 });
	assert.deepEqual(stats.detail.extensions.global, ["pi-context-view"], "npm: label shortened");
	assert.deepEqual(stats.detail.extensions.project, ["index.ts"], "local ext → path basename");
	assert.deepEqual(stats.themes, { user: 1, project: 0 });
});

test("MCP: merges shared-global + pi-global + shared-project + pi-project, tolerates missing/corrupt", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-mcp-"));
	const sharedGlobal = join(dir, "shared-global.json");
	const sharedProject = join(dir, "shared-project.json");
	const piProject = join(dir, "pi-project.json");
	writeFileSync(sharedGlobal, JSON.stringify({ mcpServers: { foo: {}, bar: {} } }));
	writeFileSync(sharedProject, "{ not valid json");
	writeFileSync(piProject, JSON.stringify({ mcpServers: { baz: {} } }));
	// pi-global comes from <agentDir>/mcp.json — "/agent" doesn't exist, so it's silently skipped.

	resetLoadedStatsCache();
	const stats = await collectLoadedStats("/cwd", "/agent", true, {
		loaderFactory: makeStubLoader({}),
		mcpPaths: { sharedGlobal, sharedProject, piProject },
	});
	assert.equal(stats.mcpServers, 3, "2 global (corrupt shared-project ignored) + 1 project");
	assert.deepEqual(stats.detail.mcp.global, ["bar", "foo"]);
	assert.deepEqual(stats.detail.mcp.project, ["baz"]);

	resetLoadedStatsCache();
	const none = await collectLoadedStats("/cwd", "/agent", true, {
		loaderFactory: makeStubLoader({}),
		mcpPaths: { sharedGlobal: join(dir, "does-not-exist.json") },
	});
	assert.equal(none.mcpServers, 0, "missing files → 0");
});

test("MCP: hasMcpAdapter=false omits MCP entirely even with config files present", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-mcp-gate-"));
	const sharedGlobal = join(dir, "shared-global.json");
	writeFileSync(sharedGlobal, JSON.stringify({ mcpServers: { foo: {}, bar: {} } }));

	resetLoadedStatsCache();
	const stats = await collectLoadedStats("/cwd", "/agent", false, {
		loaderFactory: makeStubLoader({}),
		mcpPaths: { sharedGlobal },
	});
	assert.equal(stats.mcpServers, 0, "gated off → 0 despite servers on disk");
	assert.deepEqual(stats.detail.mcp, { global: [], project: [] });
});

test("MCP: imports expand into the merged count, deduped and scoped by import kind", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-mcp-imports-"));
	const sharedGlobal = join(dir, "shared-global.json");
	const cursorPath = join(dir, "cursor-mcp.json");
	const vscodePath = join(dir, "vscode-mcp.json");
	// shared-global declares two imports: a global-scoped one (cursor) and a
	// project-scoped one (vscode) — mirrors the adapter's expandImports.
	writeFileSync(sharedGlobal, JSON.stringify({ mcpServers: { own: {} }, imports: ["cursor", "vscode"] }));
	writeFileSync(cursorPath, JSON.stringify({ mcpServers: { fromCursor: {}, shared: {} } }));
	writeFileSync(vscodePath, JSON.stringify({ mcpServers: { fromVscode: {}, shared: {} } }));

	resetLoadedStatsCache();
	const stats = await collectLoadedStats("/cwd", "/agent", true, {
		loaderFactory: makeStubLoader({}),
		mcpPaths: { sharedGlobal, cursor: cursorPath, vscode: vscodePath },
	});
	// own + fromCursor land global; fromVscode lands project; "shared" collides
	// across both — project wins the dedupe, so it appears once, in project.
	assert.deepEqual(stats.detail.mcp.global, ["fromCursor", "own"]);
	assert.deepEqual(stats.detail.mcp.project, ["fromVscode", "shared"]);
	assert.equal(stats.mcpServers, 4);
});

test("MCP: a shared-global file with 17 servers (this machine's real config) counts as 17", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-mcp-machine-"));
	const sharedGlobal = join(dir, "shared-global.json");
	const servers: Record<string, unknown> = {};
	for (let i = 0; i < 17; i++) servers[`server-${i}`] = {};
	writeFileSync(sharedGlobal, JSON.stringify({ mcpServers: servers }));

	resetLoadedStatsCache();
	const stats = await collectLoadedStats("/cwd", "/agent", true, {
		loaderFactory: makeStubLoader({}),
		mcpPaths: { sharedGlobal },
	});
	assert.equal(stats.mcpServers, 17);
});

test("the shared cache runs the loader only once until reset", async () => {
	resetLoadedStatsCache();
	let factoryCalls = 0;
	const factory: LoaderFactory = () => {
		factoryCalls++;
		return {
			reload: async () => {},
			getSkills: () => ({ skills: [] }),
			getPrompts: () => ({ prompts: [] }),
			getExtensions: () => ({ extensions: [] }),
			getThemes: () => ({ themes: [] }),
		};
	};
	const p1 = collectLoadedStats("/cwd", "/agent", false, { loaderFactory: factory });
	const p2 = collectLoadedStats("/cwd", "/agent", false, { loaderFactory: factory });
	assert.equal(p1, p2, "same cached promise");
	await p1;
	assert.equal(factoryCalls, 1, "loader constructed once");
});

test("a failed collection clears the cache so a later call retries", async () => {
	resetLoadedStatsCache();
	const boom: LoaderFactory = () => ({
		reload: async () => {
			throw new Error("scan failed");
		},
		getSkills: () => ({ skills: [] }),
		getPrompts: () => ({ prompts: [] }),
		getExtensions: () => ({ extensions: [] }),
		getThemes: () => ({ themes: [] }),
	});
	await assert.rejects(collectLoadedStats("/cwd", "/agent", false, { loaderFactory: boom }));
	// Cache cleared → a fresh good call succeeds.
	const ok = await collectLoadedStats("/cwd", "/agent", false, {
		loaderFactory: makeStubLoader({ skills: [{ name: "s", scope: "user" }] }),
	});
	assert.equal(ok.skills.user, 1);
});

test("renderLoadedMessage groups by category and omits MCP at 0", () => {
	const base = {
		skills: { user: 2, project: 1 },
		prompts: { user: 0, project: 0 },
		extensions: { user: 1, project: 0 },
		themes: { user: 1, project: 0 },
		mcpServers: 0,
		detail: {
			skills: { global: ["a", "b"], project: ["c"] },
			prompts: { global: [], project: [] },
			extensions: { global: ["ext"], project: [] },
			themes: { global: ["dark"], project: [] },
			mcp: { global: [], project: [] },
		},
	};
	const msg = renderLoadedMessage(base);
	assert.ok(msg.includes("Skills (3 · 2 global / 1 project)"));
	assert.ok(msg.includes("global:  a, b"));
	assert.ok(msg.includes("project: c"));
	assert.ok(msg.includes("Extensions (1 · 1 global / 0 project)"));
	assert.ok(!msg.includes("MCP servers"), "MCP section omitted at 0");

	const withMcp = renderLoadedMessage({
		...base,
		mcpServers: 2,
		detail: { ...base.detail, mcp: { global: ["foo"], project: ["bar"] } },
	});
	assert.ok(withMcp.includes("MCP servers (2)"));
	assert.ok(withMcp.includes("global: foo · project: bar"));
});

test("registerLoadedCommand registers /loaded and prints the listing", async () => {
	resetLoadedStatsCache();
	// Seed the shared cache so the handler reuses it (no real loader).
	await collectLoadedStats("/cwd", "/agent", false, {
		loaderFactory: makeStubLoader({ skills: [{ name: "s1", scope: "user" }] }),
	});

	const commands = new Map<string, any>();
	const sent: any[] = [];
	const pi: any = {
		registerCommand: (name: string, opts: any) => commands.set(name, opts),
		sendMessage: (m: any) => sent.push(m),
		getCommands: () => [],
	};
	registerLoadedCommand(pi);
	assert.ok(commands.has("loaded"), "/loaded registered");

	await commands.get("loaded").handler("", { cwd: "/cwd", hasUI: false });
	assert.equal(sent.length, 1, "one message sent");
	assert.equal(sent[0].customType, "cc-my-pi-loaded");
	assert.ok(sent[0].content.includes("Skills (1 · 1 global / 0 project)"));
});
