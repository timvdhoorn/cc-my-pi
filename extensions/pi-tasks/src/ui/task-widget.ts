/**
 * Static cc-my-pi adaptation of @tintinweb/pi-tasks' task widget.
 *
 * Renders one persistent task list directly above the editor. Unlike upstream,
 * it has no animated marker, task IDs, runtime/token metrics, or truncation.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { TaskStore } from "../task-store.js";
import type { TasksConfig } from "../tasks-config.js";

export type Theme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
	strikethrough(text: string): string;
};

export type UICtx = {
	setStatus(key: string, text: string | undefined): void;
	setWidget(
		key: string,
		content:
			| undefined
			| ((
					tui: any,
					theme: Theme,
			  ) => { render(): string[]; invalidate(): void }),
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
};

export class TaskWidget {
	private uiCtx: UICtx | undefined;
	private tui: any | undefined;
	private widgetRegistered = false;
	private store: TaskStore;
	private readonly config: TasksConfig;

	constructor(store: TaskStore, config: TasksConfig = {}) {
		this.store = store;
		this.config = config;
	}

	setStore(store: TaskStore): void {
		this.store = store;
	}

	setUICtx(ctx: UICtx): void {
		this.uiCtx = ctx;
	}

	setActiveTask(_taskId: string | undefined, _active = true): void {
		this.update();
	}

	addTokenUsage(_inputTokens: number, _outputTokens: number): void {}

	private renderWidget(tui: any, theme: Theme): string[] {
		const tasks = this.store.list(this.config.sortOrder ?? "id");
		if (tasks.length === 0) return [];

		const done = tasks.filter((task) => task.status === "completed").length;
		const open = tasks.length - done;
		const width = tui.terminal.columns;
		const indent = "  ";
		const lines = [
			truncateToWidth(
				`${indent}${theme.fg("muted", `${tasks.length} tasks (${done} done, ${open} open)`)}`,
				width,
			),
		];

		for (const task of tasks) {
			if (task.status === "completed") {
				lines.push(
					truncateToWidth(
						`${indent}${theme.fg("success", "✓")} ${theme.fg("muted", theme.strikethrough(task.subject))}`,
						width,
					),
				);
			} else {
				lines.push(
					truncateToWidth(
						`${indent}${theme.fg("muted", "□")} ${theme.fg("text", task.subject)}`,
						width,
					),
				);
			}
		}

		return lines;
	}

	update(): void {
		if (!this.uiCtx) return;
		const hasTasks = this.store.list().length > 0;

		if (!hasTasks) {
			if (this.widgetRegistered) this.uiCtx.setWidget("tasks", undefined);
			this.widgetRegistered = false;
			this.tui = undefined;
			return;
		}

		if (!this.widgetRegistered) {
			this.uiCtx.setWidget(
				"tasks",
				(tui, theme) => {
					this.tui = tui;
					return {
						render: () => this.renderWidget(tui, theme),
						invalidate() {},
					};
				},
				{ placement: "aboveEditor" },
			);
			this.widgetRegistered = true;
			return;
		}

		this.tui?.requestRender();
	}

	dispose(): void {
		this.uiCtx?.setWidget("tasks", undefined);
		this.widgetRegistered = false;
		this.tui = undefined;
	}
}
