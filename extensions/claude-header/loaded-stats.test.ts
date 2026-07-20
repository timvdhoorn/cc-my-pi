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
	const stats = await collectLoadedStats("/cwd", "/agent", {
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
		mcpPaths: [],
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

test("MCP servers: parses present files, tolerates missing/corrupt", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-mcp-"));
	const globalPath = join(dir, "global-mcp.json");
	const projectPath = join(dir, "project-mcp.json");
	writeFileSync(globalPath, JSON.stringify({ mcpServers: { foo: {}, bar: {} } }));
	writeFileSync(projectPath, "{ not valid json");

	resetLoadedStatsCache();
	const stats = await collectLoadedStats("/cwd", "/agent", {
		loaderFactory: makeStubLoader({}),
		mcpPaths: [globalPath, projectPath],
	});
	assert.equal(stats.mcpServers, 2, "2 global, corrupt project ignored");
	assert.deepEqual(stats.detail.mcp.global, ["foo", "bar"]);
	assert.deepEqual(stats.detail.mcp.project, []);

	resetLoadedStatsCache();
	const none = await collectLoadedStats("/cwd", "/agent", {
		loaderFactory: makeStubLoader({}),
		mcpPaths: [join(dir, "does-not-exist.json"), ""],
	});
	assert.equal(none.mcpServers, 0, "missing files → 0");
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
	const p1 = collectLoadedStats("/cwd", "/agent", { loaderFactory: factory, mcpPaths: [] });
	const p2 = collectLoadedStats("/cwd", "/agent", { loaderFactory: factory, mcpPaths: [] });
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
	await assert.rejects(collectLoadedStats("/cwd", "/agent", { loaderFactory: boom, mcpPaths: [] }));
	// Cache cleared → a fresh good call succeeds.
	const ok = await collectLoadedStats("/cwd", "/agent", {
		loaderFactory: makeStubLoader({ skills: [{ name: "s", scope: "user" }] }),
		mcpPaths: [],
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
	await collectLoadedStats("/cwd", "/agent", {
		loaderFactory: makeStubLoader({ skills: [{ name: "s1", scope: "user" }] }),
		mcpPaths: [],
	});

	const commands = new Map<string, any>();
	const sent: any[] = [];
	const pi: any = {
		registerCommand: (name: string, opts: any) => commands.set(name, opts),
		sendMessage: (m: any) => sent.push(m),
	};
	registerLoadedCommand(pi);
	assert.ok(commands.has("loaded"), "/loaded registered");

	await commands.get("loaded").handler("", { cwd: "/cwd", hasUI: false });
	assert.equal(sent.length, 1, "one message sent");
	assert.equal(sent[0].customType, "cc-my-pi-loaded");
	assert.ok(sent[0].content.includes("Skills (1 · 1 global / 0 project)"));
});
