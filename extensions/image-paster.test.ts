import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBundledImagePaster, type PasterFactory } from "./image-paster.ts";

const pi = {} as ExtensionAPI;

test("disabled image paster skips registration", () => {
  let registrations = 0;
  const factory = (() => {
    registrations += 1;
    return () => {};
  }) as PasterFactory;

  assert.equal(registerBundledImagePaster(pi, false, factory), false);
  assert.equal(registrations, 0);
});

test("enabled image paster registers exactly once with custom editor support", () => {
  let factoryCalls = 0;
  let extensionCalls = 0;
  let receivedConfig: Parameters<PasterFactory>[0];
  const factory = ((config: Parameters<PasterFactory>[0]) => {
    factoryCalls += 1;
    receivedConfig = config;
    return () => {
      extensionCalls += 1;
    };
  }) as PasterFactory;

  assert.equal(registerBundledImagePaster(pi, true, factory), true);
  assert.equal(factoryCalls, 1);
  assert.equal(extensionCalls, 1);
  assert.equal(receivedConfig!.customEditor?.enabled, true);
  assert.equal(receivedConfig!.customEditor?.showImagePreview, true);
});
