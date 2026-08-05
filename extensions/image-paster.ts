import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPaster } from "pi-paster";

export type PasterFactory = typeof createPaster;

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
  return true;
}
