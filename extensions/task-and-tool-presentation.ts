type PresentationToolStatus = "pending" | "success" | "error";

/** Individual Claude-style call/result pairs are default; grouping remains opt-in. */
export function resolveToolGroupingEnabled(
	configured: boolean | undefined,
): boolean {
	return configured === true;
}

/** Streaming output changes height while tools run, so keep it opt-in. */
export function resolveLiveToolPreviewEnabled(
	configured: boolean | undefined,
): boolean {
	return configured === true;
}

/** Stable Claude result arm: first row owns the arm, later rows align to its text. */
export function formatClaudeResultBlock(lines: string[]): string[] {
	return lines.map((line, index) =>
		index === 0 ? `  ⎿  ${line}` : `     ${line}`,
	);
}

/** Edit previews have their own diff gutter, so remove one outer column. */
export function outdentClaudeResultBlock(lines: string[]): string[] {
	return lines.map((line) => (line.startsWith(" ") ? line.slice(1) : line));
}

/** Claude Code renders tool-specific summaries directly after the bold name. */
export function formatClaudeToolCallLabel(
	toolLabel: string,
	summaryLabel: string,
): string {
	const tool = toolLabel.trim().toLowerCase();
	const summary = summaryLabel.trim();
	if (!summary || summary.toLowerCase() === tool) return toolLabel;
	return `${toolLabel}(${summaryLabel})`;
}

export interface ToolActivityState {
	isPartial: boolean;
	executionStarted: boolean;
	hasResult: boolean;
	isError: boolean;
}

export function classifyToolActivityState(
	state: ToolActivityState,
): PresentationToolStatus {
	if (state.isError) return "error";
	if (state.hasResult && !state.isPartial) return "success";
	if (state.isPartial && state.executionStarted && !state.hasResult)
		return "pending";
	return "success";
}

export const HIDDEN_TASK_TOOL_NAMES = new Set([
	"TaskCreate",
	"TaskList",
	"TaskGet",
	"TaskUpdate",
	"TaskOutput",
	"TaskStop",
	"TaskExecute",
]);

export interface ClaudeToolActivity {
	name: string;
	status: PresentationToolStatus;
	count?: number;
	added?: number;
	removed?: number;
}

export interface ClaudeToolActivityFormatting {
	formatAdded?: (value: number) => string;
	formatRemoved?: (value: number) => string;
}

interface ClaudeToolVerb {
	active: string;
	past: string;
	noun: string;
	plural: string;
}

const CLAUDE_TOOL_VERBS: Record<string, ClaudeToolVerb> = {
	read: { active: "Reading", past: "Read", noun: "file", plural: "files" },
	bash: {
		active: "Running",
		past: "Ran",
		noun: "shell command",
		plural: "shell commands",
	},
	ls: {
		active: "Listing",
		past: "Listed",
		noun: "directory",
		plural: "directories",
	},
	edit: { active: "Making", past: "Made", noun: "edit", plural: "edits" },
	write: { active: "Writing", past: "Wrote", noun: "file", plural: "files" },
	apply_patch: {
		active: "Making",
		past: "Made",
		noun: "patch",
		plural: "patches",
	},
	grep: {
		active: "Searching",
		past: "Searched",
		noun: "file",
		plural: "files",
	},
	find: {
		active: "Finding",
		past: "Found",
		noun: "file match",
		plural: "file matches",
	},
	TaskCreate: {
		active: "Creating",
		past: "Created",
		noun: "task",
		plural: "tasks",
	},
	TaskUpdate: {
		active: "Updating",
		past: "Updated",
		noun: "task",
		plural: "tasks",
	},
	TaskList: {
		active: "Listing",
		past: "Listed",
		noun: "task list",
		plural: "task lists",
	},
};

function humanizeToolName(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

function getClaudeToolVerb(name: string): ClaudeToolVerb {
	return (
		CLAUDE_TOOL_VERBS[name] ?? {
			active: "Running",
			past: "Ran",
			noun: humanizeToolName(name),
			plural: humanizeToolName(name),
		}
	);
}

function formatClaudeToolActivity(
	activity: ClaudeToolActivity & {
		count: number;
		added: number;
		removed: number;
	},
	index: number,
	formatting: ClaudeToolActivityFormatting,
): string {
	const verb = getClaudeToolVerb(activity.name);
	const rawAction = activity.status === "pending" ? verb.active : verb.past;
	const action = index === 0 ? rawAction : rawAction.toLowerCase();
	const noun = activity.count === 1 ? verb.noun : verb.plural;
	const diff = [
		activity.added > 0
			? (formatting.formatAdded?.(activity.added) ?? `+${activity.added}`)
			: "",
		activity.removed > 0
			? (formatting.formatRemoved?.(activity.removed) ?? `-${activity.removed}`)
			: "",
	]
		.filter(Boolean)
		.join(" ");
	return `${action} ${activity.count} ${noun}${diff ? ` ${diff}` : ""}`;
}

/** Claude Code-style activity prose: "Made 1 edit, read 1 file, ran 1 shell command". */
export function formatClaudeToolActivities(
	activities: ClaudeToolActivity[],
	maxKinds = 5,
	formatting: ClaudeToolActivityFormatting = {},
): string {
	const grouped = new Map<
		string,
		ClaudeToolActivity & { count: number; added: number; removed: number }
	>();
	for (const activity of activities) {
		const key = `${activity.name}\0${activity.status}`;
		const current = grouped.get(key) ?? {
			...activity,
			count: 0,
			added: 0,
			removed: 0,
		};
		current.count += activity.count ?? 1;
		current.added += activity.added ?? 0;
		current.removed += activity.removed ?? 0;
		grouped.set(key, current);
	}
	const entries = [...grouped.values()];
	if (entries.length === 0) return "Ran tools";
	const shown = entries
		.slice(0, maxKinds)
		.map((activity, index) =>
			formatClaudeToolActivity(activity, index, formatting),
		);
	if (entries.length > maxKinds) shown.push("…");
	return shown.join(", ");
}

interface ParsedTaskListLine {
	id: string;
	status: string;
	subject: string;
}

export interface TaskListPresentation {
	total: number;
	done: number;
	open: number;
	tasks: Array<ParsedTaskListLine & { completed: boolean; marker: "✓" | "□" }>;
}

function parseTaskListLine(line: string): ParsedTaskListLine | null {
	const match = line.match(/^#(\d+) \[([^\]]+)\] (.+)$/);
	if (!match) return null;
	return {
		id: match[1],
		status: match[2],
		subject: match[3],
	};
}

export function buildTaskListPresentation(
	lines: string[],
): TaskListPresentation {
	const tasks = lines.flatMap((line) => {
		const task = parseTaskListLine(line);
		if (!task) return [];
		const completed = task.status === "completed";
		return [{ ...task, completed, marker: completed ? "✓" : "□" } as const];
	});
	const done = tasks.filter((task) => task.completed).length;
	return {
		total: tasks.length,
		done,
		open: tasks.length - done,
		tasks,
	};
}
