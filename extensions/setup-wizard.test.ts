import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  openCcToolsSetupWizard,
  type CcToolsSettingsController,
  type CcToolsUiSnapshot,
} from "./cc-my-pi-settings-ui.ts";
import spinnerSetup from "./spinner.ts";

const ESC = "\x1b";
const stubTui: any = { requestRender: () => {}, width: 80, height: 24 };
const stubTheme: any = new Proxy(
  { fg: (_key: string, text: string) => text, bold: (t: string) => t },
  { get: (t, p) => (p in t ? (t as any)[p] : (x: any) => x) },
);
const stubKb: any = { matches: () => false };

const baseSnapshot: CcToolsUiSnapshot = {
  toolBackground: "outlines",
  groupToolCalls: true,
  extraToolOutputExpanded: false,
  themeAdaptive: true,
  liveToolPreview: true,
  imagePasterEnabled: true,
  escSteerEnabled: true,
  doubleEscClearEnabled: true,
  queueSteerEnabled: true,
  branchPreset: "theme",
  sessionCommandsEnabled: true,
  spinnerEnabled: true,
  spinnerVerbColor: "borderAccent",
  spinnerStatusColor: "muted",
  readOutputMode: "preview",
  bashOutputMode: "opencode",
  diffCollapsedLines: "stock",
  statuslineCtxStyle: "claude",
  statuslineShowWorktree: true,
};

/** Controller that reflects applied values back into the snapshot so def.current() advances. */
function makeController() {
  const snap: CcToolsUiSnapshot = { ...baseSnapshot };
  const applyCalls: Array<[string, string]> = [];
  const controller: CcToolsSettingsController = {
    getSnapshot: () => ({ ...snap }),
    apply(id, value) {
      applyCalls.push([String(id), value]);
      const key = id as keyof CcToolsUiSnapshot;
      (snap as any)[key] = typeof snap[key] === "boolean" ? value === "on" : value;
    },
  };
  return { controller, applyCalls };
}

/** ctx.ui.custom captures the wizard component and defers resolution until done() fires. */
function makeUiCtx() {
  let component: any;
  const notifies: Array<[string, string]> = [];
  const ctx: any = {
    hasUI: true,
    ui: {
      theme: stubTheme,
      requestRender: () => {},
      notify: (msg: string, level: string) => notifies.push([msg, level]),
      custom: (factory: any) =>
        new Promise<void>((resolve) => {
          component = factory(stubTui, stubTheme, stubKb, () => resolve());
        }),
    },
  };
  return { ctx, notifies, getComponent: () => component };
}

/** Total number of wizard steps parsed from the "step X/N" header. */
function stepCount(component: any): number {
  const header = component.render(80)[0] as string;
  const match = header.match(/step \d+\/(\d+)/);
  assert.ok(match, `header should contain step counter, got: ${header}`);
  return Number(match![1]);
}

test("wizard: without UI notifies TUI-required and never opens an overlay", async () => {
  const { controller } = makeController();
  const notifies: Array<[string, string]> = [];
  let customCalled = false;
  const ctx: any = {
    hasUI: false,
    ui: {
      notify: (msg: string, level: string) => notifies.push([msg, level]),
      custom: () => {
        customCalled = true;
        return Promise.resolve();
      },
    },
  };

  await openCcToolsSetupWizard(ctx, controller);

  assert.equal(customCalled, false);
  assert.equal(notifies.length, 1);
  assert.equal(notifies[0]![1], "error");
});

/** Advance (Enter) until the step header names `label`; returns the component. */
function advanceToStep(component: any, label: string): void {
  for (let i = 0; i < 40; i++) {
    if ((component.render(80)[0] as string).includes(label)) return;
    component.handleInput("\r");
  }
  assert.fail(`never reached step "${label}"`);
}

test("wizard: intro screen offers start / skip-now / skip-forever", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  openCcToolsSetupWizard(ctx, controller);
  const intro = getComponent().render(80).join("\n");
  assert.ok(intro.includes("cc-my-pi setup"), "intro shows the title");
  assert.ok(
    intro.includes("enter start · s skip for now · x don't ask again"),
    "intro shows the key legend",
  );
});

test("wizard: intro 's' resolves skip-once", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();
  const done = openCcToolsSetupWizard(ctx, controller);
  getComponent().handleInput("s");
  assert.equal(await done, "skip-once");
});

test("wizard: intro 'x' resolves skip-forever", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();
  const done = openCcToolsSetupWizard(ctx, controller);
  getComponent().handleInput("x");
  assert.equal(await done, "skip-forever");
});

test("wizard: intro Esc (raw and kitty CSI-u) resolves skip-once", async () => {
  for (const esc of [ESC, "\x1b[27u"]) {
    const { controller } = makeController();
    const { ctx, getComponent } = makeUiCtx();
    const done = openCcToolsSetupWizard(ctx, controller);
    getComponent().handleInput(esc);
    assert.equal(await done, "skip-once", `esc encoding ${JSON.stringify(esc)}`);
  }
});

test("wizard: Enter on intro enters steps; Esc there resolves completed", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  const done = openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  component.handleInput("\r"); // leave intro
  assert.match(component.render(80)[0] as string, /step 1\//);

  component.handleInput("\x1b[27u"); // kitty-encoded Esc mid-steps
  assert.equal(await done, "completed");
});

test("wizard: cycling a value applies it live and shows the changed preview", async () => {
  const { controller, applyCalls } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  const done = openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  component.handleInput("\r"); // pass the intro
  component.handleInput(" "); // space cycles the focused (first) setting forward
  assert.deepEqual(applyCalls.at(-1), ["toolBackground", "transparent"]);

  const rendered = component.render(80).join("\n");
  assert.ok(
    rendered.includes("changed: Tool style → transparent"),
    "preview should echo the changed setting",
  );

  component.handleInput(ESC); // finish
  assert.equal(await done, "completed");
});

test("wizard: steps derive from SETTING_ORDER and enter through all closes it", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  const done = openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  component.handleInput("\r"); // pass the intro
  const total = stepCount(component);
  assert.ok(total >= 18, `expected all settings as steps, got ${total}`);

  for (let i = 0; i < total; i++) component.handleInput("\r"); // last one finishes
  assert.equal(await done, "completed");
});

test("wizard: back navigation does not go before the first step", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  const done = openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  component.handleInput("\r"); // pass the intro
  component.handleInput("b"); // already at step 1 — no-op
  assert.match(component.render(80)[0] as string, /step 1\//);

  component.handleInput("\r"); // to step 2
  assert.match(component.render(80)[0] as string, /step 2\//);
  component.handleInput("b"); // back to step 1
  assert.match(component.render(80)[0] as string, /step 1\//);

  component.handleInput(ESC);
  await done;
});

test("wizard: every frame renders to a constant height", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  const introHeight = component.render(80).length;
  component.handleInput("\r"); // into steps (step 1)
  const step1Height = component.render(80).length;
  component.handleInput(" "); // cycle Tool style — shifts the preview shape
  const cycledHeight = component.render(80).length;
  component.handleInput("\r"); // step 2: Group tools
  component.handleInput(" "); // groupToolCalls off — different preview tree
  const groupedOffHeight = component.render(80).length;

  assert.equal(step1Height, introHeight, "step 1 matches intro height");
  assert.equal(cycledHeight, introHeight, "cycling a value keeps the height");
  assert.equal(groupedOffHeight, introHeight, "a different preview shape keeps the height");
});

test("wizard: a custom out-of-list value is the selected default and cycles into the list", async () => {
  const custom = "#d77757";
  const snap: CcToolsUiSnapshot = { ...baseSnapshot, spinnerVerbColor: custom };
  const applyCalls: Array<[string, string]> = [];
  const controller: CcToolsSettingsController = {
    getSnapshot: () => ({ ...snap }),
    apply(id, value) {
      applyCalls.push([String(id), value]);
      (snap as any)[id as keyof CcToolsUiSnapshot] = value;
    },
  };
  const { ctx, getComponent } = makeUiCtx();

  openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();
  component.handleInput("\r"); // pass the intro
  advanceToStep(component, "Spinner verb");

  const atStep = component.render(80).join("\n");
  assert.ok(atStep.includes(`● ${custom}`), "custom value is the selected default");
  assert.equal(applyCalls.length, 0, "entering steps without cycling changes nothing");

  component.handleInput(" "); // one cycle forward
  assert.deepEqual(
    applyCalls.at(-1),
    ["spinnerVerbColor", "borderAccent"],
    "cycling lands on the first curated value",
  );
});

/** Fake pi that records on() registrations. */
function makeSpinnerPi() {
  const handlers: string[] = [];
  const pi = {
    on: (event: string) => handlers.push(event),
    getThinkingLevel: () => "off",
  } as unknown as ExtensionAPI;
  return { pi, handlers };
}

function homeWithSettings(settings: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), "ccpi-home-"));
  mkdirSync(join(home, ".pi"), { recursive: true });
  writeFileSync(join(home, ".pi", "settings.json"), JSON.stringify(settings));
  return home;
}

test("spinner: spinnerEnabled false bails before registering handlers", () => {
  const prevHome = process.env.HOME;
  process.env.HOME = homeWithSettings({ spinnerEnabled: false });
  try {
    const { pi, handlers } = makeSpinnerPi();
    spinnerSetup(pi);
    assert.equal(handlers.length, 0);
  } finally {
    process.env.HOME = prevHome;
  }
});

test("spinner: default (no setting) registers its lifecycle handlers", () => {
  const prevHome = process.env.HOME;
  process.env.HOME = homeWithSettings({});
  try {
    const { pi, handlers } = makeSpinnerPi();
    spinnerSetup(pi);
    assert.ok(handlers.length > 0);
    assert.ok(handlers.includes("session_shutdown"));
  } finally {
    process.env.HOME = prevHome;
  }
});

test("session commands: registers /exit and /clear when enabled, nothing when disabled", async () => {
  const { registerSessionCommands } = await import("./session-commands.ts");
  const makePi = () => {
    const commands = new Map<string, any>();
    return {
      pi: { registerCommand: (name: string, def: any) => commands.set(name, def) } as any,
      commands,
    };
  };

  const on = makePi();
  registerSessionCommands(on.pi, true);
  assert.deepEqual([...on.commands.keys()].sort(), ["clear", "exit"]);

  const off = makePi();
  registerSessionCommands(off.pi, false);
  assert.equal(off.commands.size, 0);

  const notices: string[] = [];
  const ctx: any = {
    waitForIdle: async () => {},
    newSession: async () => ({ cancelled: true }),
    ui: { notify: (msg: string) => notices.push(msg) },
  };
  await on.commands.get("clear").handler("", ctx);
  assert.deepEqual(notices, ["New session cancelled"]);
});
