/**
 * Resource counting for the startup header + the `/loaded` command (plan 031).
 *
 * Counts and lists what Pi actually loaded — skills, prompts, extensions,
 * themes and MCP servers — using Pi core's own `DefaultResourceLoader` so the
 * numbers match Pi's native startup listing exactly (no hand-rolled directory
 * scans).
 *
 * MCP servers mirror pi-mcp-adapter's own config resolution (config.ts) —
 * shared-global (`~/.config/mcp/mcp.json`), pi-global (`<agentDir>/mcp.json`),
 * shared-project (`<cwd>/.mcp.json`) and pi-project (`<cwd>/.pi/mcp.json`),
 * plus `imports` expansion (cursor/claude-code/claude-desktop/codex/windsurf/
 * vscode) — so the count matches what the adapter actually loads, not just
 * the two pi-owned files. Counting is gated on the adapter being installed
 * (`mcp` command registered); otherwise MCP is omitted entirely, even if
 * config files exist.
 *
 * A single module-level promise is shared: the header kicks it off and `/loaded`
 * reuses it, so the filesystem scan happens once per process.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { DefaultResourceLoader, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface CategoryDetail {
	/** Names loaded from the user (global) scope. */
	global: string[];
	/** Names loaded from the project scope. */
	project: string[];
}

export interface LoadedStats {
	skills: { user: number; project: number };
	prompts: { user: number; project: number };
	extensions: { user: number; project: number };
	themes: { user: number; project: number };
	/** Total unique MCP servers across all pi-mcp-adapter sources (0 when the adapter isn't installed). */
	mcpServers: number;
	/** Full name lists retained for `/loaded` rendering. */
	detail: {
		skills: CategoryDetail;
		prompts: CategoryDetail;
		extensions: CategoryDetail;
		themes: CategoryDetail;
		mcp: CategoryDetail;
	};
}

/** Minimal shape of the resource loader (so tests can stub it). */
export interface ResourceLoaderLike {
	reload(): Promise<void>;
	getSkills(): { skills: Array<{ name?: string; sourceInfo?: { scope?: string } }> };
	getPrompts(): { prompts: Array<{ name?: string; sourceInfo?: { scope?: string } }> };
	getExtensions(): {
		extensions: Array<{ path?: string; resolvedPath?: string; sourceInfo?: { scope?: string; source?: string } }>;
	};
	getThemes(): { themes: Array<{ name?: string; sourceInfo?: { scope?: string } }> };
}

export type LoaderFactory = (opts: { cwd: string; agentDir: string }) => ResourceLoaderLike;

export interface CollectOptions {
	/** Inject a stub loader for tests; production uses DefaultResourceLoader. */
	loaderFactory?: LoaderFactory;
	/** Override MCP resolution paths for tests; production derives them from cwd/agentDir/homedir. */
	mcpPaths?: Partial<McpResolutionPaths>;
}

/** MCP `imports` kinds pi-mcp-adapter supports (config.ts `ImportKind`). */
type ImportKind = "cursor" | "claude-code" | "claude-desktop" | "codex" | "windsurf" | "vscode";

const IMPORT_KINDS: ImportKind[] = ["cursor", "claude-code", "claude-desktop", "codex", "windsurf", "vscode"];

/** vscode's import path is project-relative; every other import kind is homedir-based (global). */
const IMPORT_SCOPE: Record<ImportKind, "global" | "project"> = {
	cursor: "global",
	"claude-code": "global",
	"claude-desktop": "global",
	codex: "global",
	windsurf: "global",
	vscode: "project",
};

/** Homedir/cwd-derived MCP config paths, mirroring pi-mcp-adapter's `config.ts`. */
export interface McpResolutionPaths {
	sharedGlobal: string;
	sharedProject: string;
	piProject: string;
	cursor: string;
	claudeCode: string[];
	claudeDesktop: string;
	codex: string;
	windsurf: string;
	vscode: string;
}

function defaultMcpResolutionPaths(cwd: string): McpResolutionPaths {
	const home = homedir();
	return {
		sharedGlobal: join(home, ".config", "mcp", "mcp.json"),
		sharedProject: join(cwd, ".mcp.json"),
		piProject: join(cwd, ".pi", "mcp.json"),
		cursor: join(home, ".cursor", "mcp.json"),
		claudeCode: [
			join(home, ".claude", "mcp.json"),
			join(home, ".claude.json"),
			join(home, ".claude", "claude_desktop_config.json"),
		],
		claudeDesktop: join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
		codex: join(home, ".codex", "config.json"),
		windsurf: join(home, ".windsurf", "mcp.json"),
		vscode: join(cwd, ".vscode", "mcp.json"),
	};
}

interface RawMcpFile {
	mcpServers?: Record<string, unknown>;
	imports?: string[];
}

/** Parse a `{ mcpServers?, imports? }` file; missing/corrupt → undefined, never throw. */
function readMcpFile(path: string): RawMcpFile | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as RawMcpFile;
	} catch {
		// missing file / parse error → skip
	}
	return undefined;
}

function serverNamesOf(file: RawMcpFile | undefined): string[] {
	const servers = file?.mcpServers;
	if (servers && typeof servers === "object" && !Array.isArray(servers)) return Object.keys(servers);
	return [];
}

function importKindsOf(file: RawMcpFile | undefined): ImportKind[] {
	if (!Array.isArray(file?.imports)) return [];
	return file.imports.filter((k): k is ImportKind => (IMPORT_KINDS as string[]).includes(k));
}

function importCandidates(kind: ImportKind, paths: McpResolutionPaths): string[] {
	switch (kind) {
		case "cursor":
			return [paths.cursor];
		case "claude-code":
			return paths.claudeCode;
		case "claude-desktop":
			return [paths.claudeDesktop];
		case "codex":
			return [paths.codex];
		case "windsurf":
			return [paths.windsurf];
		case "vscode":
			return [paths.vscode];
	}
}

/** First existing candidate for an import kind (adapter's `resolveImportPath`). */
function resolveImportPath(kind: ImportKind, paths: McpResolutionPaths): string | undefined {
	return importCandidates(kind, paths).find((candidate) => existsSync(candidate));
}

/**
 * Count + list MCP servers across all sources pi-mcp-adapter resolves: the
 * two pi-owned files, the two shared files, plus any `imports` any of those
 * four files declare. Names are deduped overall; on a global/project name
 * collision the project entry wins (mirrors the adapter's merge order, where
 * project sources are merged last and override same-named global ones).
 * Returns nothing at all when the adapter isn't installed (`hasMcpAdapter`).
 */
function collectMcpServers(
	cwd: string,
	agentDir: string,
	hasMcpAdapter: boolean,
	overridePaths?: Partial<McpResolutionPaths>,
): { total: number; detail: CategoryDetail } {
	if (!hasMcpAdapter) return { total: 0, detail: { global: [], project: [] } };

	const paths: McpResolutionPaths = { ...defaultMcpResolutionPaths(cwd), ...overridePaths };
	const piGlobalPath = join(agentDir, "mcp.json");

	const sharedGlobal = readMcpFile(paths.sharedGlobal);
	const piGlobal = readMcpFile(piGlobalPath);
	const sharedProject = readMcpFile(paths.sharedProject);
	const piProject = readMcpFile(paths.piProject);

	const globalNames = new Set<string>([...serverNamesOf(sharedGlobal), ...serverNamesOf(piGlobal)]);
	const projectNames = new Set<string>([...serverNamesOf(sharedProject), ...serverNamesOf(piProject)]);

	const declaredImports = new Set<ImportKind>([
		...importKindsOf(sharedGlobal),
		...importKindsOf(piGlobal),
		...importKindsOf(sharedProject),
		...importKindsOf(piProject),
	]);

	for (const kind of declaredImports) {
		const importPath = resolveImportPath(kind, paths);
		if (!importPath) continue;
		const bucket = IMPORT_SCOPE[kind] === "project" ? projectNames : globalNames;
		for (const name of serverNamesOf(readMcpFile(importPath))) bucket.add(name);
	}

	for (const name of projectNames) globalNames.delete(name);

	return {
		total: globalNames.size + projectNames.size,
		detail: { global: [...globalNames].sort(), project: [...projectNames].sort() },
	};
}

/** Pi's default agent dir (`~/.pi/agent`), honoring any env override core supports. */
export function resolveAgentDir(): string {
	return getAgentDir();
}

/** Project scope → project bucket; user/temporary/missing → global (user) bucket. */
function isProject(scope: string | undefined): boolean {
	return scope === "project";
}

function bucket<T>(items: T[], nameOf: (item: T) => string, scopeOf: (item: T) => string | undefined): {
	user: number;
	project: number;
	detail: CategoryDetail;
} {
	const detail: CategoryDetail = { global: [], project: [] };
	for (const item of items) {
		const name = nameOf(item);
		if (!name) continue;
		if (isProject(scopeOf(item))) detail.project.push(name);
		else detail.global.push(name);
	}
	return { user: detail.global.length, project: detail.project.length, detail };
}

/** Extension display label: npm short name, explicit source, or path basename. */
function extensionLabel(ext: { path?: string; resolvedPath?: string; sourceInfo?: { source?: string } }): string {
	const src = ext.sourceInfo?.source;
	if (src?.startsWith("npm:")) return src.slice("npm:".length);
	if (src && src !== "auto" && src !== "local") return src;
	const path = ext.path ?? ext.resolvedPath ?? "";
	return path ? basename(path) : "extension";
}

let statsPromise: Promise<LoadedStats> | undefined;

async function doCollect(
	cwd: string,
	agentDir: string,
	hasMcpAdapter: boolean,
	options?: CollectOptions,
): Promise<LoadedStats> {
	const loader: ResourceLoaderLike = options?.loaderFactory
		? options.loaderFactory({ cwd, agentDir })
		: new DefaultResourceLoader({ cwd, agentDir });
	await loader.reload();

	const skills = bucket(
		loader.getSkills().skills,
		(s) => s.name ?? "",
		(s) => s.sourceInfo?.scope,
	);
	const prompts = bucket(
		loader.getPrompts().prompts,
		(p) => p.name ?? "",
		(p) => p.sourceInfo?.scope,
	);
	const extensions = bucket(
		loader.getExtensions().extensions,
		(e) => extensionLabel(e),
		(e) => e.sourceInfo?.scope,
	);
	const themes = bucket(
		loader.getThemes().themes,
		(t) => t.name ?? "",
		(t) => t.sourceInfo?.scope,
	);

	const mcp = collectMcpServers(cwd, agentDir, hasMcpAdapter, options?.mcpPaths);

	return {
		skills: { user: skills.user, project: skills.project },
		prompts: { user: prompts.user, project: prompts.project },
		extensions: { user: extensions.user, project: extensions.project },
		themes: { user: themes.user, project: themes.project },
		mcpServers: mcp.total,
		detail: {
			skills: skills.detail,
			prompts: prompts.detail,
			extensions: extensions.detail,
			themes: themes.detail,
			mcp: mcp.detail,
		},
	};
}

/**
 * Collect loaded-resource stats, shared process-wide. First caller starts the
 * scan; the header and `/loaded` reuse the same promise. A failed collection
 * clears the cache so a later call can retry. `hasMcpAdapter` gates MCP
 * counting entirely — pass `pi.getCommands().some((c) => c.name === "mcp")`.
 */
export function collectLoadedStats(
	cwd: string,
	agentDir: string,
	hasMcpAdapter: boolean,
	options?: CollectOptions,
): Promise<LoadedStats> {
	if (!statsPromise) {
		statsPromise = doCollect(cwd, agentDir, hasMcpAdapter, options).catch((err) => {
			statsPromise = undefined;
			throw err;
		});
	}
	return statsPromise;
}

/** Drop the shared cache (tests only; `/reload` re-imports the module anyway). */
export function resetLoadedStatsCache(): void {
	statsPromise = undefined;
}

function categoryLines(label: string, cat: CategoryDetail): string[] {
	const total = cat.global.length + cat.project.length;
	const lines = [`${label} (${total} · ${cat.global.length} global / ${cat.project.length} project)`];
	if (cat.global.length) lines.push(`  global:  ${cat.global.join(", ")}`);
	if (cat.project.length) lines.push(`  project: ${cat.project.join(", ")}`);
	return lines;
}

/** Render the `/loaded` message body. MCP section omitted entirely at 0. */
export function renderLoadedMessage(stats: LoadedStats): string {
	const sections = [
		categoryLines("Skills", stats.detail.skills),
		categoryLines("Prompts", stats.detail.prompts),
		categoryLines("Extensions", stats.detail.extensions),
		categoryLines("Themes", stats.detail.themes),
	];
	if (stats.mcpServers > 0) {
		const { global, project } = stats.detail.mcp;
		const parts: string[] = [];
		if (global.length) parts.push(`global: ${global.join(", ")}`);
		if (project.length) parts.push(`project: ${project.join(", ")}`);
		const mcp = [`MCP servers (${stats.mcpServers})`];
		if (parts.length) mcp.push(`  ${parts.join(" · ")}`);
		sections.push(mcp);
	}
	return sections.map((s) => s.join("\n")).join("\n");
}

/**
 * Register `/loaded` — ALWAYS registered (independent of the header setting).
 * Prints the per-category listing grouped global vs project.
 */
export function registerLoadedCommand(pi: ExtensionAPI): void {
	pi.registerCommand("loaded", {
		description: "Show loaded skills, prompts, extensions, themes and MCP servers",
		handler: async (_args, ctx) => {
			try {
				const hasMcpAdapter = pi.getCommands().some((c) => c.name === "mcp");
				const stats = await collectLoadedStats(ctx.cwd, resolveAgentDir(), hasMcpAdapter);
				pi.sendMessage({ customType: "cc-my-pi-loaded", content: renderLoadedMessage(stats), display: true });
			} catch (err) {
				const message = `/loaded could not read resources: ${err instanceof Error ? err.message : String(err)}`;
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				else pi.sendMessage({ customType: "cc-my-pi-loaded", content: message, display: true });
			}
		},
	});
}
