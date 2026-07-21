import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  COMPANION_INSTALL_VALUE,
  COMPANION_STEPS,
  CORE_STEPS,
  SETTING_ORDER,
  openCcToolsSetupWizard,
  wizardStepValues,
  type CcToolsSettingsController,
  type CcToolsUiSnapshot,
} from "./cc-my-pi-settings-ui.ts";
import { COMPANION_PACKAGES } from "./companion-packages.ts";
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
  companionsInstalled: { "npm:pi-context-view": true },
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

/** Toggle the intro choice to "custom" and enter the steps phase. */
function enterCustom(component: any): void {
  component.handleInput("l"); // standard -> custom
  component.handleInput("\r"); // enter steps
}

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

  enterCustom(component); // custom walkthrough includes the core settings
  advanceToStep(component, "Tool style");
  component.handleInput(" "); // space cycles the focused setting forward
  assert.deepEqual(applyCalls.at(-1), ["toolBackground", "transparent"]);

  const rendered = component.render(80).join("\n");
  assert.ok(
    rendered.includes("changed: Tool style → transparent"),
    "preview should echo the changed setting",
  );

  component.handleInput(ESC); // finish
  assert.equal(await done, "completed");
});

test("wizard: custom steps derive from SETTING_ORDER and enter through all closes it", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  const done = openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  enterCustom(component); // custom walks every setting
  const total = stepCount(component);
  assert.equal(total, SETTING_ORDER.length, "custom mode covers every setting row");

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
  enterCustom(component); // Spinner verb is a core setting
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

test("wizard: intro offers standard/custom and arrow toggles the selection", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  const intro = component.render(80).join("\n");
  assert.ok(intro.includes("standard"), "standard option shown");
  assert.ok(intro.includes("custom"), "custom option shown");
  assert.ok(intro.includes("choose"), "choose hint shown");
  // standard is selected by default: its line carries the ● marker.
  assert.match(intro, /● standard/);

  component.handleInput("l"); // toggle to custom
  const afterToggle = component.render(80).join("\n");
  assert.match(afterToggle, /● custom/, "custom becomes the selected option");
});

test("wizard: standard mode walks only the companion rows and finishes completed", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  const done = openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  component.handleInput("\r"); // standard (default) enters steps
  assert.equal(stepCount(component), COMPANION_STEPS.length, "only companion rows are steps");
  assert.ok(
    (component.render(80)[0] as string).includes(COMPANION_PACKAGES[0]!.name),
    "step 1 is the first companion row",
  );

  // Advance through every companion; none of them is a core setting label.
  const coreLabels = new Set(CORE_STEPS.map((d) => d.label));
  for (let i = 0; i < COMPANION_STEPS.length; i++) {
    const header = component.render(80)[0] as string;
    for (const label of coreLabels) {
      assert.ok(!header.includes(`: ${label}`), `standard mode never shows core setting "${label}"`);
    }
    component.handleInput("\r"); // last one finishes
  }
  assert.equal(await done, "completed");
});

test("wizard: custom mode orders companions first, then core settings", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();

  enterCustom(component);
  assert.equal(stepCount(component), SETTING_ORDER.length, "custom covers all rows");
  // Step 1 is the first companion; the first core setting only appears after them.
  assert.ok(
    (component.render(80)[0] as string).includes(COMPANION_PACKAGES[0]!.name),
    "companions come first",
  );
  advanceToStep(component, COMPANION_PACKAGES.at(-1)!.name); // last companion
  component.handleInput("\r"); // next step is the first core setting
  assert.ok(
    (component.render(80)[0] as string).includes(CORE_STEPS[0]!.label),
    "core settings follow the companions",
  );
});

test("wizard: standard mode still applies core wizard defaults (quiet startup)", async () => {
  const snap: CcToolsUiSnapshot = {
    ...baseSnapshot,
    claudeHeaderEnabled: true,
    quietStartup: false,
  };
  const applyCalls: Array<[string, string]> = [];
  const controller: CcToolsSettingsController = {
    getSnapshot: () => ({ ...snap }),
    apply(id, value) {
      applyCalls.push([String(id), value]);
      const key = id as keyof CcToolsUiSnapshot;
      (snap as any)[key] = typeof snap[key] === "boolean" ? value === "on" : value;
    },
  };
  const { ctx, getComponent } = makeUiCtx();

  openCcToolsSetupWizard(ctx, controller);
  getComponent().handleInput("\r"); // standard mode enters steps
  assert.ok(
    applyCalls.some(([id, value]) => id === "quietStartup" && value === "on"),
    "quiet startup default lands even though core steps are skipped",
  );
});

test("wizard: s / x / Esc on the intro still resolve skip-once / skip-forever / skip-once", async () => {
  const cases: Array<[string, string]> = [
    ["s", "skip-once"],
    ["x", "skip-forever"],
    [ESC, "skip-once"],
  ];
  for (const [key, expected] of cases) {
    const { controller } = makeController();
    const { ctx, getComponent } = makeUiCtx();
    const done = openCcToolsSetupWizard(ctx, controller);
    getComponent().handleInput(key);
    assert.equal(await done, expected, `intro key ${JSON.stringify(key)}`);
  }
});

test("companions: one row per companion, ids companion:<source>, after regular rows", () => {
  const companionRows = SETTING_ORDER.filter((def) => String(def.id).startsWith("companion:"));
  assert.equal(companionRows.length, COMPANION_PACKAGES.length);
  assert.deepEqual(
    companionRows.map((def) => def.id),
    COMPANION_PACKAGES.map((c) => `companion:${c.source}`),
  );
  assert.deepEqual(
    companionRows.map((def) => def.label),
    COMPANION_PACKAGES.map((c) => c.name),
  );
  // Placed after all regular settings rows: the tail of SETTING_ORDER is exactly
  // the companion rows, and nothing before them is a companion.
  const firstCompanion = SETTING_ORDER.findIndex((def) => String(def.id).startsWith("companion:"));
  assert.equal(firstCompanion, SETTING_ORDER.length - COMPANION_PACKAGES.length);
  for (let i = 0; i < firstCompanion; i++) {
    assert.ok(!String(SETTING_ORDER[i]!.id).startsWith("companion:"));
  }
});

test("companions: installed row shows ✓ installed, not-installed shows ✗ not installed", () => {
  const snap: CcToolsUiSnapshot = {
    ...baseSnapshot,
    companionsInstalled: { "npm:pi-context-view": true },
  };
  const installed = SETTING_ORDER.find((def) => def.id === "companion:npm:pi-context-view")!;
  const notInstalled = SETTING_ORDER.find((def) => def.id === "companion:npm:pi-subagents")!;
  assert.equal(installed.current(snap), "✓ installed");
  assert.equal(notInstalled.current(snap), "✗ not installed");
});

test("companions: wizardStepValues offers the install action; installed row keeps ✓ as current", () => {
  const snap: CcToolsUiSnapshot = {
    ...baseSnapshot,
    companionsInstalled: { "npm:pi-context-view": true },
  };
  const installed = SETTING_ORDER.find((def) => def.id === "companion:npm:pi-context-view")!;
  const notInstalled = SETTING_ORDER.find((def) => def.id === "companion:npm:pi-subagents")!;

  const notInstalledValues = wizardStepValues(notInstalled, snap);
  assert.ok(notInstalledValues.includes(COMPANION_INSTALL_VALUE), "install action offered");

  const installedValues = wizardStepValues(installed, snap);
  assert.ok(installedValues.includes(COMPANION_INSTALL_VALUE), "install action still offered");
  assert.equal(installedValues[0], "✓ installed", "current value is the selected default");
});

/** Mirror of index.ts's companion apply-intercept, over a fake PackagesFile. */
function applyCompanion(
  id: string,
  value: string,
  packagesFile: { install: (source: string) => void },
): void {
  if (!id.startsWith("companion:")) return;
  if (value !== COMPANION_INSTALL_VALUE) return;
  packagesFile.install(id.slice("companion:".length));
}

test("companions: apply install action calls install once; other values are ignored", () => {
  const installs: string[] = [];
  const packagesFile = { install: (source: string) => installs.push(source) };

  applyCompanion("companion:npm:pi-subagents", COMPANION_INSTALL_VALUE, packagesFile);
  assert.deepEqual(installs, ["npm:pi-subagents"]);

  applyCompanion("companion:npm:pi-subagents", "✗ not installed", packagesFile);
  applyCompanion("companion:npm:pi-subagents", "✓ installed", packagesFile);
  assert.deepEqual(installs, ["npm:pi-subagents"], "display values never install");
});

test("companions: wizard frame with companion rows keeps the constant height", async () => {
  const { controller } = makeController();
  const { ctx, getComponent } = makeUiCtx();

  openCcToolsSetupWizard(ctx, controller);
  const component = getComponent();
  const introHeight = component.render(80).length;

  component.handleInput("\r"); // into steps
  advanceToStep(component, COMPANION_PACKAGES[0]!.name); // first companion row
  assert.equal(component.render(80).length, introHeight, "companion row keeps the height");

  advanceToStep(component, COMPANION_PACKAGES.at(-1)!.name); // last companion row
  assert.equal(component.render(80).length, introHeight, "last companion row keeps the height");
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
