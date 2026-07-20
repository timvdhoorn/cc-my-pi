import assert from "node:assert/strict";
import test from "node:test";
import {
	buildPickerOptions,
	extractAssistantText,
	extractCodeBlocks,
	registerCopyCommand,
} from "./copy-command.ts";

/** Fake pi recording registerCommand definitions. */
function makePi() {
	const commands = new Map<string, any>();
	return {
		pi: { registerCommand: (name: string, def: any) => commands.set(name, def) } as any,
		commands,
	};
}

/** Fake command ctx with stubbed select/notify and a canned branch. */
function makeCtx(opts: {
	branch: any[];
	selectReturns?: string | undefined;
	hasUI?: boolean;
}) {
	const notifies: Array<[string, string]> = [];
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const ctx: any = {
		hasUI: opts.hasUI ?? true,
		waitForIdle: async () => {},
		sessionManager: { getBranch: () => opts.branch },
		ui: {
			notify: (msg: string, level: string) => notifies.push([msg, level]),
			select: async (title: string, options: string[]) => {
				selectCalls.push({ title, options });
				return opts.selectReturns;
			},
		},
	};
	return { ctx, notifies, selectCalls };
}

function assistantEntry(content: unknown) {
	return { type: "message", message: { role: "assistant", content } };
}
function userEntry(content: unknown) {
	return { type: "message", message: { role: "user", content } };
}

/** Register /copy-code and return the handler plus a recording clipboard fn. */
function makeHandler(
	ctxOpts: Parameters<typeof makeCtx>[0],
	settings?: { copyAlwaysFull?: boolean; setCopyAlwaysFull?: (v: boolean) => void },
	clipboardImpl?: (t: string) => Promise<void>,
) {
	const copied: string[] = [];
	const setCalls: boolean[] = [];
	const { pi, commands } = makePi();
	registerCopyCommand(
		pi,
		true,
		{
			copyAlwaysFull: () => settings?.copyAlwaysFull ?? false,
			setCopyAlwaysFull: (v) => {
				setCalls.push(v);
				settings?.setCopyAlwaysFull?.(v);
			},
		},
		{
			copyToClipboard:
				clipboardImpl ??
				(async (t: string) => {
					copied.push(t);
				}),
		},
	);
	const { ctx, notifies, selectCalls } = makeCtx(ctxOpts);
	return { handler: commands.get("copy-code").handler, copied, setCalls, ctx, notifies, selectCalls };
}

// --- extractCodeBlocks ------------------------------------------------------

test("extractCodeBlocks: single block with language", () => {
	const blocks = extractCodeBlocks("intro\n```js\nconst x = 1;\n```\nend");
	assert.deepEqual(blocks, [{ lang: "js", code: "const x = 1;" }]);
});

test("extractCodeBlocks: multiple blocks", () => {
	const blocks = extractCodeBlocks("```py\na\n```\ntext\n```sh\nb\n```");
	assert.deepEqual(blocks, [
		{ lang: "py", code: "a" },
		{ lang: "sh", code: "b" },
	]);
});

test("extractCodeBlocks: block without language has empty lang", () => {
	const blocks = extractCodeBlocks("```\nplain\n```");
	assert.deepEqual(blocks, [{ lang: "", code: "plain" }]);
});

test("extractCodeBlocks: no fences returns empty", () => {
	assert.deepEqual(extractCodeBlocks("just prose, no code"), []);
});

test("extractCodeBlocks: unclosed fence is ignored", () => {
	assert.deepEqual(extractCodeBlocks("```js\nconst x = 1;\nno closing fence"), []);
});

test("extractCodeBlocks: inline backticks in content are preserved verbatim", () => {
	const blocks = extractCodeBlocks("```md\nuse `code` here\n```");
	assert.deepEqual(blocks, [{ lang: "md", code: "use `code` here" }]);
});

// --- extractAssistantText ---------------------------------------------------

test("extractAssistantText: string content returned as-is", () => {
	assert.equal(extractAssistantText("hello world"), "hello world");
});

test("extractAssistantText: array joins text blocks", () => {
	const content = [
		{ type: "text", text: "line 1" },
		{ type: "text", text: "line 2" },
	];
	assert.equal(extractAssistantText(content), "line 1\nline 2");
});

test("extractAssistantText: non-text blocks are skipped", () => {
	const content = [
		{ type: "text", text: "keep" },
		{ type: "thinking", thinking: "drop" },
		{ type: "tool_call", name: "drop" },
	];
	assert.equal(extractAssistantText(content), "keep");
});

// --- buildPickerOptions -----------------------------------------------------

test("buildPickerOptions: numbering, truncation, lang fallback, distinct duplicates", () => {
	const full = "a\nb\nc";
	const longFirstLine = "x".repeat(80);
	const blocks = [
		{ lang: "js", code: "const y = 1;" },
		{ lang: "", code: `${longFirstLine}\nmore` },
		{ lang: "js", code: "const y = 1;" },
	];
	const options = buildPickerOptions(full, blocks);

	assert.equal(options[0], `1. Full response  (5 chars, 3 lines)`);
	assert.equal(options[1], "2. const y = 1;  [js]");
	assert.equal(options[2], `3. ${"x".repeat(60)}…  [text]`);
	assert.equal(options[3], "4. const y = 1;  [js]");
	assert.equal(
		options[4],
		"5. Always copy full response  (skip this picker; revert via /cc-my-pi settings)",
	);
	// Two identical blocks stay distinguishable via the leading number.
	assert.notEqual(options[1], options[3]);
});

// --- /copy-code handler ----------------------------------------------------------

test("copy: happy path shows picker and copies the chosen block", async () => {
	const text = "here\n```js\nconst z = 2;\n```";
	const blocks = extractCodeBlocks(text);
	const options = buildPickerOptions(text, blocks);
	const { handler, copied, ctx, notifies, selectCalls } = makeHandler({
		branch: [userEntry("hi"), assistantEntry(text)],
		selectReturns: options[1], // the code block
	});

	await handler("", ctx);

	assert.equal(selectCalls.length, 1);
	assert.deepEqual(selectCalls[0]!.options, options);
	assert.deepEqual(copied, ["const z = 2;"]);
	assert.equal(notifies[0]![1], "info");
	assert.match(notifies[0]![0], /Copied to clipboard/);
});

test("copy: no code blocks copies full text without a picker", async () => {
	const { handler, copied, ctx, notifies, selectCalls } = makeHandler({
		branch: [assistantEntry("plain answer, no fences")],
	});

	await handler("", ctx);

	assert.equal(selectCalls.length, 0);
	assert.deepEqual(copied, ["plain answer, no fences"]);
	assert.match(notifies[0]![0], /Copied full response/);
});

test("copy: copyAlwaysFull skips picker and copies full text", async () => {
	const text = "answer\n```js\nx\n```";
	const { handler, copied, ctx, selectCalls } = makeHandler(
		{ branch: [assistantEntry(text)] },
		{ copyAlwaysFull: true },
	);

	await handler("", ctx);

	assert.equal(selectCalls.length, 0);
	assert.deepEqual(copied, [text]);
});

test("copy: 'Always copy full response' choice persists preference and copies full", async () => {
	const text = "answer\n```js\nx\n```";
	const blocks = extractCodeBlocks(text);
	const options = buildPickerOptions(text, blocks);
	const { handler, copied, setCalls, ctx, notifies } = makeHandler({
		branch: [assistantEntry(text)],
		selectReturns: options[options.length - 1], // Always copy full response
	});

	await handler("", ctx);

	assert.deepEqual(setCalls, [true]);
	assert.deepEqual(copied, [text]);
	assert.match(notifies[0]![0], /picker disabled/);
});

test("copy: cancelled picker (undefined) copies nothing and stays silent", async () => {
	const text = "answer\n```js\nx\n```";
	const { handler, copied, ctx, notifies } = makeHandler({
		branch: [assistantEntry(text)],
		selectReturns: undefined,
	});

	await handler("", ctx);

	assert.deepEqual(copied, []);
	assert.equal(notifies.length, 0);
});

test("copy: no assistant message notifies and never touches the clipboard", async () => {
	const { handler, copied, ctx, notifies } = makeHandler({
		branch: [userEntry("only a user message")],
	});

	await handler("", ctx);

	assert.deepEqual(copied, []);
	assert.deepEqual(notifies, [["No assistant response to copy", "info"]]);
});

test("copy: clipboard failure surfaces the error message", async () => {
	const { handler, ctx, notifies } = makeHandler(
		{ branch: [assistantEntry("plain answer")] },
		undefined,
		async () => {
			throw new Error("pbcopy not found");
		},
	);

	await handler("", ctx);

	assert.equal(notifies[0]![1], "error");
	assert.match(notifies[0]![0], /Copy failed: pbcopy not found/);
});

test("copy: disabled never registers the command", () => {
	const { pi, commands } = makePi();
	registerCopyCommand(pi, false, {
		copyAlwaysFull: () => false,
		setCopyAlwaysFull: () => {},
	});
	assert.equal(commands.size, 0);
});
