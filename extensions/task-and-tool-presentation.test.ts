/// <reference types="node" />

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	buildTaskListPresentation,
	classifyToolActivityState,
	formatClaudeResultBlock,
	formatClaudeToolActivities,
	formatClaudeToolCallLabel,
	HIDDEN_TASK_TOOL_NAMES,
	outdentClaudeResultBlock,
	resolveLiveToolPreviewEnabled,
	resolveToolGroupingEnabled,
} from "./task-and-tool-presentation.ts";

function readExampleConfig(): {
	groupToolCalls?: boolean;
	liveToolPreview?: boolean;
} {
	try {
		return JSON.parse(
			readFileSync(
				new URL("../config/config.example.json", import.meta.url),
				"utf8",
			),
		) as { groupToolCalls?: boolean; liveToolPreview?: boolean };
	} catch (error) {
		throw new Error("config/config.example.json must contain valid JSON", {
			cause: error,
		});
	}
}

test("fresh-install tool presentation matches example config", () => {
	const config = readExampleConfig();

	assert.equal(resolveToolGroupingEnabled(undefined), config.groupToolCalls);
	assert.equal(
		resolveLiveToolPreviewEnabled(undefined),
		config.liveToolPreview,
	);
});

test("individual Claude-style tool calls are the default", () => {
	assert.equal(resolveToolGroupingEnabled(undefined), false);
	assert.equal(resolveToolGroupingEnabled(false), false);
	assert.equal(resolveToolGroupingEnabled(true), true);
});

test("all pi-tasks tools stay hidden from chat", () => {
	assert.deepEqual(
		[...HIDDEN_TASK_TOOL_NAMES],
		[
			"TaskCreate",
			"TaskList",
			"TaskGet",
			"TaskUpdate",
			"TaskOutput",
			"TaskStop",
			"TaskExecute",
		],
	);
	assert.equal(HIDDEN_TASK_TOOL_NAMES.has("bash"), false);
});

test("every started partial tool stays pending across sequential calls", () => {
	assert.equal(
		classifyToolActivityState({
			isPartial: true,
			executionStarted: true,
			hasResult: false,
			isError: false,
		}),
		"pending",
	);
});

test("unstarted partial history does not resume blinking", () => {
	assert.equal(
		classifyToolActivityState({
			isPartial: true,
			executionStarted: false,
			hasResult: false,
			isError: false,
		}),
		"success",
	);
});

test("task list presentation counts every non-completed task as open", () => {
	const presentation = buildTaskListPresentation([
		"#1 [completed] Test task 1 — setup complete",
		"#2 [pending] Test task 2 — execute",
		"#3 [in_progress] Test task 3 — verify result",
	]);

	assert.deepEqual(
		{
			total: presentation.total,
			done: presentation.done,
			open: presentation.open,
			completed: presentation.tasks.map((task) => task.completed),
			markers: presentation.tasks.map((task) => task.marker),
		},
		{
			total: 3,
			done: 1,
			open: 2,
			completed: [true, false, false],
			markers: ["✓", "□", "□"],
		},
	);
});

test("task list presentation ignores unrelated output", () => {
	assert.deepEqual(buildTaskListPresentation(["No tasks found"]), {
		total: 0,
		done: 0,
		open: 0,
		tasks: [],
	});
});

test("transient live tool output is opt-in", () => {
	assert.equal(resolveLiveToolPreviewEnabled(undefined), false);
	assert.equal(resolveLiveToolPreviewEnabled(false), false);
	assert.equal(resolveLiveToolPreviewEnabled(true), true);
});

test("tool results use one Claude arm and aligned continuation rows", () => {
	assert.deepEqual(formatClaudeResultBlock(["Read 120 lines", "second row"]), [
		"  ⎿  Read 120 lines",
		"     second row",
	]);
});

test("Edit result blocks sit one column left of other tool results", () => {
	assert.deepEqual(
		outdentClaudeResultBlock(["  ⎿  +1 at line 1", "     diff row"]),
		[" ⎿  +1 at line 1", "    diff row"],
	);
});

test("individual tool call labels use Claude Code parentheses", () => {
	assert.equal(
		formatClaudeToolCallLabel("Read", "src/app.ts"),
		"Read(src/app.ts)",
	);
	assert.equal(formatClaudeToolCallLabel("Read", "Read"), "Read");
	assert.equal(formatClaudeToolCallLabel("Bash", ""), "Bash");
});

test("completed tool group uses Claude-style past-tense activity prose", () => {
	assert.equal(
		formatClaudeToolActivities([
			{ name: "edit", status: "success", added: 3, removed: 1 },
			{ name: "read", status: "success" },
			{ name: "ls", status: "success" },
			{ name: "bash", status: "success" },
		]),
		"Made 1 edit +3 -1, read 1 file, listed 1 directory, ran 1 shell command",
	);
});

test("active tool group uses progressive verbs and combines matching calls", () => {
	assert.equal(
		formatClaudeToolActivities([
			{ name: "edit", status: "pending", added: 7 },
			{ name: "edit", status: "pending" },
			{ name: "bash", status: "pending" },
		]),
		"Making 2 edits +7, running 1 shell command",
	);
});
