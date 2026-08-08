import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	IMAGE_PASTER_EDITOR_FEATURE,
	registerBundledImagePaster,
	type PasterFactory,
} from "./image-paster.ts";

const pi = { on() {} } as unknown as ExtensionAPI;

test("disabled image paster skips registration", () => {
	let registrations = 0;
	const factory = (() => {
		registrations += 1;
		return () => {};
	}) as PasterFactory;

	assert.equal(registerBundledImagePaster(pi, false, factory), false);
	assert.equal(registrations, 0);
});

test("real image paster installs and tags custom editor on session start", async () => {
	const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
	let editorFactory: any;
	const fakePi = {
		on(name: string, handler: (...args: any[]) => unknown) {
			const current = handlers.get(name) ?? [];
			current.push(handler);
			handlers.set(name, current);
		},
		registerCommand() {},
		registerMessageRenderer() {},
	} as unknown as ExtensionAPI;

	assert.equal(registerBundledImagePaster(fakePi, true), true);
	const sessionStartHandlers = handlers.get("session_start") ?? [];
	assert.equal(sessionStartHandlers.length, 2);
	const ctx = {
		mode: "tui",
		hasUI: true,
		cwd: process.cwd(),
		ui: {
			setWidget() {},
			setEditorComponent(factory: unknown) {
				editorFactory = factory;
			},
			getEditorComponent() {
				return editorFactory;
			},
		},
	};
	for (const handler of sessionStartHandlers) handler({}, ctx);
	await Promise.resolve();

	assert.equal(typeof editorFactory, "function");
	const features = editorFactory[Symbol.for("@tmustier/pi-editor-features")];
	assert.equal(features.has(IMAGE_PASTER_EDITOR_FEATURE), true);
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
	assert.equal(receivedConfig!.customEditor?.showImagePreview, false);
});
