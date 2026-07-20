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

test("wizard: cycling a value applies it live and shows the changed preview", async () => {
  const { controller, applyCalls } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  const done = openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  component.handleInput(" "); // space cycles the focused (first) setting forward
  assert.deepEqual(applyCalls.at(-1), ["toolBackground", "transparent"]);

  const rendered = component.render(80).join("\n");
  assert.ok(
    rendered.includes("changed: Tool style → transparent"),
    "preview should echo the changed setting",
  );

  component.handleInput(ESC); // finish
  await done;
});

test("wizard: steps derive from SETTING_ORDER and enter through all closes it", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  const done = openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  const total = stepCount(component);
  assert.ok(total >= 18, `expected all settings as steps, got ${total}`);

  let resolved = false;
  void done.then(() => {
    resolved = true;
  });

  for (let i = 0; i < total; i++) component.handleInput("\r"); // enter advances, last one finishes
  await done;
  assert.equal(resolved, true);
});

test("wizard: back navigation does not go before the first step", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  const done = openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  component.handleInput("b"); // already at step 1 — no-op
  assert.match(component.render(80)[0] as string, /step 1\//);

  component.handleInput("\r"); // to step 2
  assert.match(component.render(80)[0] as string, /step 2\//);
  component.handleInput("b"); // back to step 1
  assert.match(component.render(80)[0] as string, /step 1\//);

  component.handleInput(ESC);
  await done;
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
