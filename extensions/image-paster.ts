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
    submittedPreviewStyle: "raw",
    includeImagePathsInPrompt: true,
    customEditor: {
      enabled: true,
      showImagePreview: true,
      deletePlaceholderAsBlock: true,
    },
  })(pi);
  return true;
}
