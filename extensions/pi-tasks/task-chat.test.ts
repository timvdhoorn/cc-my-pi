import assert from "node:assert/strict";
import test from "node:test";
import { TaskWidget, type Theme, type UICtx } from "./src/ui/task-widget.ts";
import type { Task } from "./src/types.ts";

const tasks: Task[] = [
	{
		id: "1",
		subject: "Afgeronde taak",
		description: "done",
		status: "completed",
		metadata: {},
		blocks: [],
		blockedBy: [],
		createdAt: 1,
		updatedAt: 2,
	},
	{
		id: "2",
		subject: "Open taak",
		description: "open",
		status: "in_progress",
		metadata: {},
		blocks: [],
		blockedBy: [],
		createdAt: 1,
		updatedAt: 2,
	},
];

const theme: Theme = {
	fg(_color, text) {
		return text;
	},
	bold(text) {
		return text;
	},
	strikethrough(text) {
		return `~${text}~`;
	},
};

test("task widget renders one static list above editor", () => {
	let factory: Parameters<UICtx["setWidget"]>[1];
	let placement: "aboveEditor" | "belowEditor" | undefined;
	let renderRequests = 0;
	const ui: UICtx = {
		setStatus() {},
		setWidget(key, content, options) {
			assert.equal(key, "tasks");
			factory = content;
			placement = options?.placement;
		},
	};
	const store = {
		list: () => tasks,
	};
	const widget = new TaskWidget(store as never);

	widget.setUICtx(ui);
	widget.update();

	assert.equal(placement, "aboveEditor");
	assert.equal(typeof factory, "function");
	const component = factory!(
		{ terminal: { columns: 120 }, requestRender: () => renderRequests++ },
		theme,
	);
	assert.deepEqual(component.render(), [
		"  2 tasks (1 done, 1 open)",
		"  ✓ ~Afgeronde taak~",
		"  □ Open taak",
	]);

	widget.update();
	assert.equal(renderRequests, 1);
});

test("task widget hides itself after final task is cleared", () => {
	let currentTasks = [...tasks];
	const calls: Array<{ content: unknown; placement?: string }> = [];
	const ui: UICtx = {
		setStatus() {},
		setWidget(_key, content, options) {
			calls.push({ content, placement: options?.placement });
		},
	};
	const widget = new TaskWidget({ list: () => currentTasks } as never);

	widget.setUICtx(ui);
	widget.update();
	currentTasks = [];
	widget.update();

	assert.equal(typeof calls[0].content, "function");
	assert.deepEqual(calls[1], { content: undefined, placement: undefined });
});
