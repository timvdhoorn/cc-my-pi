import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPaster } from "pi-paster";

export type PasterFactory = typeof createPaster;

const EDITOR_FEATURES = Symbol.for("@tmustier/pi-editor-features");
export const IMAGE_PASTER_EDITOR_FEATURE = "pi-paster";

export function registerBundledImagePaster(
	pi: ExtensionAPI,
	enabled: boolean,
	factory: PasterFactory = createPaster,
): boolean {
	if (!enabled) return false;
	factory({
		// collapsible = cheaper history paint than raw full-res kitty frames
		submittedPreviewStyle: "collapsible",
		includeImagePathsInPrompt: true,
		customEditor: {
			enabled: true,
			// Cursor hover previews re-encode kitty graphics every move — major lag on paste.
			showImagePreview: false,
			deletePlaceholderAsBlock: true,
		},
	})(pi);

	// pi-paster replaces editor factory during session_start. Tag resulting chain
	// after all synchronous handlers run so late cc-my-pi wrappers preserve and
	// expose image-paste capability instead of silently replacing it.
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		queueMicrotask(() => {
			const editorFactory = ctx.ui.getEditorComponent();
			if (!editorFactory) return;
			const features: ReadonlySet<string> =
				(editorFactory as any)[EDITOR_FEATURES] ?? new Set();
			(editorFactory as any)[EDITOR_FEATURES] = new Set([
				...features,
				IMAGE_PASTER_EDITOR_FEATURE,
			]);
		});
	});
	return true;
}
