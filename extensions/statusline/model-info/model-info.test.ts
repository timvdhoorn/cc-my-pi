import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import modelInfo from "./index.ts";

test("message_update accepts Pi v0.84 delta-only payloads", () => {
  const handlers = new Map<string, (event: any, ctx?: any) => unknown>();
  const pi = {
    on: (name: string, handler: (event: any, ctx?: any) => unknown) =>
      handlers.set(name, handler),
    events: {
      on() {},
      emit() {},
    },
    getThinkingLevel: () => "off",
  } as unknown as ExtensionAPI;

  modelInfo(pi);
  const update = handlers.get("message_update");
  assert.ok(update);
  assert.doesNotThrow(() =>
    update({ assistantMessageEvent: { type: "text_delta", delta: "hello" } }),
  );
  assert.doesNotThrow(() =>
    update({ assistantMessageEvent: { type: "toolcall_delta", delta: "{}" } }),
  );
});
