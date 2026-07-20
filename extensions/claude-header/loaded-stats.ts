/**
 * Resource counting for the startup header + the `/loaded` command (plan 031).
 *
 * Counts and lists what Pi actually loaded — skills, prompts, extensions,
 * themes and MCP servers — using Pi core's own `DefaultResourceLoader` so the
 * numbers match Pi's native startup listing exactly (no hand-rolled directory
 * scans). MCP servers come from the pi-mcp-adapter config files (`mcp.json`).
 *
 * A single module-level promise is shared: the header kicks it off and `/loaded`
 * reuses it, so the filesystem scan happens once per process.
 */
import { readFileSync } from "node:fs";
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
	/** Total MCP servers across global + project `mcp.json`. */
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
	/** Override MCP config paths for tests; production derives them from cwd/agentDir. */
	mcpPaths?: string[];
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

/** Parse `mcpServers` keys from a single mcp.json; missing/corrupt → []. */
function readMcpServerNames(path: string): string[] {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: unknown };
		const servers = parsed?.mcpServers;
		if (servers && typeof servers === "object") return Object.keys(servers);
	} catch {
		// missing file / parse error → no servers, never throw
	}
	return [];
}

let statsPromise: Promise<LoadedStats> | undefined;

async function doCollect(cwd: string, agentDir: string, options?: CollectOptions): Promise<LoadedStats> {
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

	const [globalMcp, projectMcp] = options?.mcpPaths
		? [options.mcpPaths[0] ? readMcpServerNames(options.mcpPaths[0]) : [], options.mcpPaths[1] ? readMcpServerNames(options.mcpPaths[1]) : []]
		: [readMcpServerNames(join(agentDir, "mcp.json")), readMcpServerNames(join(cwd, ".pi", "mcp.json"))];

	return {
		skills: { user: skills.user, project: skills.project },
		prompts: { user: prompts.user, project: prompts.project },
		extensions: { user: extensions.user, project: extensions.project },
		themes: { user: themes.user, project: themes.project },
		mcpServers: globalMcp.length + projectMcp.length,
		detail: {
			skills: skills.detail,
			prompts: prompts.detail,
			extensions: extensions.detail,
			themes: themes.detail,
			mcp: { global: globalMcp, project: projectMcp },
		},
	};
}

/**
 * Collect loaded-resource stats, shared process-wide. First caller starts the
 * scan; the header and `/loaded` reuse the same promise. A failed collection
 * clears the cache so a later call can retry.
 */
export function collectLoadedStats(cwd: string, agentDir: string, options?: CollectOptions): Promise<LoadedStats> {
	if (!statsPromise) {
		statsPromise = doCollect(cwd, agentDir, options).catch((err) => {
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
				const stats = await collectLoadedStats(ctx.cwd, resolveAgentDir());
				pi.sendMessage({ customType: "cc-my-pi-loaded", content: renderLoadedMessage(stats), display: true });
			} catch (err) {
				const message = `/loaded could not read resources: ${err instanceof Error ? err.message : String(err)}`;
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				else pi.sendMessage({ customType: "cc-my-pi-loaded", content: message, display: true });
			}
		},
	});
}
