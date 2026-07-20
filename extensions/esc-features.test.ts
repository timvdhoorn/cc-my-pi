import assert from "node:assert/strict";
import test from "node:test";
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBundledEscSteer } from "./esc-steer.ts";
import { registerBundledDoubleEscClear } from "./double-esc-clear.ts";

const EDITOR_FEATURES = Symbol.for("@tmustier/pi-editor-features");
const ESC = "\x1b";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stubTui: any = {
  on: () => {},
  off: () => {},
  requestRender: () => {},
  width: 80,
  height: 24,
  cols: 80,
  rows: 24,
  write: () => {},
};
const stubTheme: any = new Proxy({}, { get: () => (x: any) => x });
// Only "app.interrupt" for Escape is matched; nothing matches submit, so
// esc-steer's injectSubmit falls to its "\r" last resort (still observable).
const stubKb: any = {
  matches: (data: string, action: string) => action === "app.interrupt" && data === ESC,
};

/** Minimal pi.on recorder. */
function makePi() {
  const handlers = new Map<string, (event: any, ctx: any) => void>();
  const pi = {
    on: (event: string, handler: (event: any, ctx: any) => void) => {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  return { pi, handlers };
}

/** ctx whose editor component can be read/replaced and whose idle state is mutable. */
function makeCtx(previous?: any) {
  const state = { current: previous, idle: true, setCalls: 0 };
  const widgets = new Map<string, unknown>();
  const ctx: any = {
    mode: "tui",
    isIdle: () => state.idle,
    ui: {
      theme: stubTheme,
      getEditorComponent: () => state.current,
      setEditorComponent: (factory: any) => {
        state.current = factory;
        state.setCalls += 1;
      },
      setWidget: (key: string, content: unknown) => {
        if (content === undefined) widgets.delete(key);
        else widgets.set(key, content);
      },
      notify: () => {},
    },
  };
  return { ctx, state, widgets };
}

test("double-esc-clear: two Esc within 800ms clears a non-empty draft", () => {
  const { pi, handlers } = makePi();
  registerBundledDoubleEscClear(pi, () => true);
  const { ctx } = makeCtx();
  handlers.get("session_start")!({}, ctx);

  const editor: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);
  assert.ok(editor instanceof CustomEditor);
  editor.setText("hello");

  editor.handleInput(ESC); // first Esc: arms timer, falls through (no-op on draft)
  assert.equal(editor.getText(), "hello");
  editor.handleInput(ESC); // second Esc within window: clears
  assert.equal(editor.getText(), "");
});

test("double-esc-clear: outside the window does not clear", async () => {
  const { pi, handlers } = makePi();
  registerBundledDoubleEscClear(pi, () => true);
  const { ctx } = makeCtx();
  handlers.get("session_start")!({}, ctx);

  const editor: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);
  editor.setText("world");

  editor.handleInput(ESC);
  await sleep(2100);
  editor.handleInput(ESC); // outside window: re-arms, does not clear
  assert.equal(editor.getText(), "world");
});

test("double-esc-clear: first Esc shows a right-aligned hint above the editor", () => {
  const { pi, handlers } = makePi();
  registerBundledDoubleEscClear(pi, () => true);
  const { ctx, widgets } = makeCtx();
  handlers.get("session_start")!({}, ctx);

  const editor: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);
  editor.setText("hello");

  editor.handleInput(ESC);
  assert.ok(widgets.has("cc-my-pi-double-esc-hint"));

  const factory: any = widgets.get("cc-my-pi-double-esc-hint");
  const component = factory(stubTui, stubTheme);
  const [line] = component.render(80);
  assert.ok(line.endsWith("Esc again to clear\x1b[0m"));
  assert.ok(line.includes(" ".repeat(80 - "Esc again to clear".length)));
});

test("double-esc-clear: second Esc clears draft and hides the hint", () => {
  const { pi, handlers } = makePi();
  registerBundledDoubleEscClear(pi, () => true);
  const { ctx, widgets } = makeCtx();
  handlers.get("session_start")!({}, ctx);

  const editor: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);
  editor.setText("hello");

  editor.handleInput(ESC);
  editor.handleInput(ESC);
  assert.equal(editor.getText(), "");
  assert.ok(!widgets.has("cc-my-pi-double-esc-hint"));
});

test("double-esc-clear: hint auto-hides after the window elapses", async () => {
  const { pi, handlers } = makePi();
  registerBundledDoubleEscClear(pi, () => true);
  const { ctx, widgets } = makeCtx();
  handlers.get("session_start")!({}, ctx);

  const editor: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);
  editor.setText("hello");

  editor.handleInput(ESC);
  assert.ok(widgets.has("cc-my-pi-double-esc-hint"));
  await sleep(2100);
  assert.ok(!widgets.has("cc-my-pi-double-esc-hint"));
});

test("double-esc-clear: typing after Esc hides the hint", () => {
  const { pi, handlers } = makePi();
  registerBundledDoubleEscClear(pi, () => true);
  const { ctx, widgets } = makeCtx();
  handlers.get("session_start")!({}, ctx);

  const editor: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);
  editor.setText("hello");

  editor.handleInput(ESC);
  assert.ok(widgets.has("cc-my-pi-double-esc-hint"));
  editor.handleInput("a");
  assert.ok(!widgets.has("cc-my-pi-double-esc-hint"));
});

test("double-esc-clear: disabled gate lets Esc pass through unchanged", () => {
  const { pi, handlers } = makePi();
  registerBundledDoubleEscClear(pi, () => false);
  const { ctx } = makeCtx();
  handlers.get("session_start")!({}, ctx);

  const editor: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);
  editor.setText("hello");

  editor.handleInput(ESC);
  editor.handleInput(ESC);
  assert.equal(editor.getText(), "hello");
});

test("double-esc-clear: wraps a cross-realm editor (capabilities, not instanceof)", () => {
  const { pi, handlers } = makePi();
  registerBundledDoubleEscClear(pi, () => true);

  // Editor from ANOTHER copy of pi-coding-agent (e.g. pi-raw-paste): fully
  // capable, but not instanceof this package's CustomEditor.
  let text = "hello";
  const foreign = {
    handleInput: (_data: string) => {},
    getText: () => text,
    setText: (value: string) => {
      text = value;
    },
    isShowingAutocomplete: () => false,
  };
  const previous: any = () => foreign;
  const { ctx, widgets } = makeCtx(previous);
  handlers.get("session_start")!({}, ctx);

  const editor: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);
  assert.equal(editor, foreign); // same instance, wrapped in place

  editor.handleInput(ESC);
  assert.ok(widgets.has("cc-my-pi-double-esc-hint")); // feature active
  editor.handleInput(ESC);
  assert.equal(text, ""); // second Esc cleared the draft
});

test("double-esc-clear: busy: first Esc shows hint and does not clear", () => {
  const { pi, handlers } = makePi();
  registerBundledDoubleEscClear(pi, () => true);
  const { ctx, state, widgets } = makeCtx();
  handlers.get("session_start")!({}, ctx);

  const editor: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);
  state.idle = false; // agent busy
  editor.setText("hello");

  editor.handleInput(ESC); // first Esc: shows hint, swallowed (does not abort)
  assert.equal(editor.getText(), "hello");
  assert.ok(widgets.has("cc-my-pi-double-esc-hint"));
});

test("double-esc-clear: busy: second Esc clears the draft", () => {
  const { pi, handlers } = makePi();
  registerBundledDoubleEscClear(pi, () => true);
  const { ctx, state, widgets } = makeCtx();
  handlers.get("session_start")!({}, ctx);

  const editor: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);
  state.idle = false; // agent busy
  editor.setText("hello");

  editor.handleInput(ESC);
  editor.handleInput(ESC); // second Esc within window: clears
  assert.equal(editor.getText(), "");
  assert.ok(!widgets.has("cc-my-pi-double-esc-hint"));
});

test("double-esc-clear: already-stamped factory is not wrapped twice", () => {
  const { pi, handlers } = makePi();
  registerBundledDoubleEscClear(pi, () => true);

  const stamped: any = () => ({});
  stamped[EDITOR_FEATURES] = new Set(["double-esc-clear"]);
  const { ctx, state } = makeCtx(stamped);
  handlers.get("session_start")!({}, ctx);

  assert.equal(state.setCalls, 0);
  assert.equal(ctx.ui.getEditorComponent(), stamped);
});

test("esc-steer: disabled gate does not inject a submit after settle", async () => {
  const { pi, handlers } = makePi();
  registerBundledEscSteer(pi, () => false);

  const calls: string[] = [];
  const previous: any = () => ({
    handleInput: (data: string) => calls.push(data),
    isShowingAutocomplete: () => false,
  });
  const { ctx, state } = makeCtx(previous);

  handlers.get("session_start")!({}, ctx);
  const wrapped: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);

  state.idle = false; // agent busy
  wrapped.handleInput(ESC); // gated off: passes straight through
  state.idle = true;
  handlers.get("agent_settled")!({}, ctx);
  await tick();
  await tick();

  assert.deepEqual(calls, [ESC]); // no injected "\r"
});

test("esc-steer: enabled gate injects a submit after settle", async () => {
  const { pi, handlers } = makePi();
  registerBundledEscSteer(pi, () => true);

  const calls: string[] = [];
  const previous: any = () => ({
    handleInput: (data: string) => calls.push(data),
    isShowingAutocomplete: () => false,
  });
  const { ctx, state } = makeCtx(previous);

  handlers.get("session_start")!({}, ctx);
  const wrapped: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);

  state.idle = false; // agent busy
  wrapped.handleInput(ESC); // enabled + busy: arm + pass through
  state.idle = true;
  handlers.get("agent_settled")!({}, ctx);
  await tick();
  await tick();

  assert.deepEqual(calls, [ESC, "\r"]); // interrupt passed through, then submit injected
});

test("esc-steer: busy + typed draft: Esc is not armed, no submit after settle", async () => {
  const { pi, handlers } = makePi();
  registerBundledEscSteer(pi, () => true);

  const calls: string[] = [];
  const previous: any = () => ({
    handleInput: (data: string) => calls.push(data),
    isShowingAutocomplete: () => false,
    getText: () => "draft",
  });
  const { ctx, state } = makeCtx(previous);

  handlers.get("session_start")!({}, ctx);
  const wrapped: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);

  state.idle = false; // agent busy
  wrapped.handleInput(ESC); // typed draft: not armed, passes through only
  state.idle = true;
  handlers.get("agent_settled")!({}, ctx);
  await tick();
  await tick();

  assert.deepEqual(calls, [ESC]); // no injected "\r"
});

test("esc-steer: busy + whitespace-only draft still injects submit", async () => {
  const { pi, handlers } = makePi();
  registerBundledEscSteer(pi, () => true);

  const calls: string[] = [];
  const previous: any = () => ({
    handleInput: (data: string) => calls.push(data),
    isShowingAutocomplete: () => false,
    getText: () => "  ",
  });
  const { ctx, state } = makeCtx(previous);

  handlers.get("session_start")!({}, ctx);
  const wrapped: any = ctx.ui.getEditorComponent()(stubTui, stubTheme, stubKb);

  state.idle = false; // agent busy
  wrapped.handleInput(ESC); // whitespace-only counts as empty: armed
  state.idle = true;
  handlers.get("agent_settled")!({}, ctx);
  await tick();
  await tick();

  assert.deepEqual(calls, [ESC, "\r"]);
});

test("esc-steer: already-stamped factory is not wrapped twice", async () => {
  const { pi, handlers } = makePi();
  registerBundledEscSteer(pi, () => true);

  const stamped: any = () => ({});
  stamped[EDITOR_FEATURES] = new Set(["esc-steer"]);
  const { ctx, state } = makeCtx(stamped);

  handlers.get("session_start")!({}, ctx);
  await tick(); // also let scheduleEditorInstall's setTimeout run

  assert.equal(state.setCalls, 0);
  assert.equal(ctx.ui.getEditorComponent(), stamped);
});
