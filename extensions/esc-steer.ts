/**
 * pi-esc-steer
 *
 * Claude Code-like Escape while the agent is running:
 * abort the current run, then immediately continue with whatever was queued
 * (steer / follow-up), instead of only pausing or dumping the queue into the editor.
 *
 * Works with:
 * - stock @tmustier/pi-queue-steer (Esc pauses → we auto-resume with empty Enter)
 * - native Pi queues (Esc restores queue text into the editor → we auto-submit)
 *
 * Does not own a queue. Composes via editor wrapping + agent_settled.
 *
 * Bundled copy of the standalone `pi-esc-steer` package by the same author,
 * exposed as a register function gated by a live `isEnabled` getter so the
 * /cc-tools settings toggle takes effect without a Pi reload. Shares the
 * `esc-steer` feature marker with the standalone package, so the two are
 * mutually exclusive automatically.
 */
import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";

const EDITOR_FEATURES = Symbol.for("@tmustier/pi-editor-features");
const FEATURE = "esc-steer";

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;
type ComposedEditorFactory = EditorFactory & { [EDITOR_FEATURES]?: ReadonlySet<string> };

function editorFeatures(factory: EditorFactory | undefined): ReadonlySet<string> {
	return (factory as ComposedEditorFactory | undefined)?.[EDITOR_FEATURES] ?? new Set();
}

export function registerBundledEscSteer(
	pi: ExtensionAPI,
	isEnabled: () => boolean,
): void {
	let activeContext: ExtensionContext | undefined;
	let editorInstallTimer: ReturnType<typeof setTimeout> | undefined;
	/** After an abort Esc, fire one empty/restored submit once the run has settled. */
	let continueAfterAbort = false;
	let injectSubmit: (() => void) | undefined;

	const armContinueAfterAbort = (): void => {
		continueAfterAbort = true;
	};

	const tryContinueQueued = (ctx: ExtensionContext): void => {
		if (!isEnabled()) {
			continueAfterAbort = false;
			return;
		}
		if (!continueAfterAbort) return;
		if (!ctx.isIdle()) return;
		continueAfterAbort = false;

		// Let pi-queue-steer / CustomEditor observe an empty-composer submit
		// (resume paused lanes) or a restored-queue submit (native Esc path).
		const fire = injectSubmit;
		if (!fire) return;

		// Defer past settled/finally so nested prompt is safe.
		setTimeout(() => {
			if (!ctx.isIdle()) {
				// Run got busy again; skip rather than fight it.
				return;
			}
			try {
				fire();
			} catch (error) {
				ctx.ui.notify(
					`pi-esc-steer: could not continue after abort: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		}, 0);
	};

	const installEditor = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;

		const previousFactory = ctx.ui.getEditorComponent();
		const features = editorFeatures(previousFactory);
		// Always re-wrap if we are not the outermost marker — other extensions
		// may install later. Only skip when our feature is already on the factory
		// we would wrap (we are already composed in this chain position).
		if (features.has(FEATURE)) return;

		const factory = ((tui, theme, keybindings: KeybindingsManager) => {
			const editor =
				previousFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
			const handleInput = editor.handleInput.bind(editor);

			const isShowingAutocomplete = (): boolean => {
				const candidate = editor as typeof editor & { isShowingAutocomplete?: () => boolean };
				return candidate.isShowingAutocomplete?.() ?? false;
			};

			injectSubmit = () => {
				// Default Enter / return. CustomEditor + pi-queue-steer match via
				// keybindings.matches(data, "tui.input.submit") — "\r" is the usual bind.
				const candidates = ["\r", "\n"];
				for (const submit of candidates) {
					if (keybindings.matches(submit, "tui.input.submit")) {
						// queue-steer resume needs empty composer; native Esc path may
						// already have restored queue text — leave editor content as-is.
						handleInput(submit);
						return;
					}
				}
				// Last resort
				handleInput("\r");
			};

			editor.handleInput = (data: string): void => {
				const isInterrupt =
					typeof keybindings.matches === "function"
						? keybindings.matches(data, "app.interrupt")
						: data === "\x1b";

				if (isInterrupt && isEnabled() && !isShowingAutocomplete() && !ctx.isIdle()) {
					// Pass through so pi-queue-steer can pause, or native Esc can
					// restore native queues into the editor — then continue on settle.
					armContinueAfterAbort();
					handleInput(data);
					return;
				}

				handleInput(data);
			};

			return editor;
		}) as ComposedEditorFactory;
		factory[EDITOR_FEATURES] = new Set([...features, FEATURE]);
		ctx.ui.setEditorComponent(factory);
	};

	const scheduleEditorInstall = (ctx: ExtensionContext): void => {
		if (editorInstallTimer) clearTimeout(editorInstallTimer);
		// Late so we wrap outside pi-queue-steer / double-esc / hud.
		editorInstallTimer = setTimeout(() => {
			editorInstallTimer = undefined;
			installEditor(ctx);
		}, 0);
	};

	pi.on("session_start", (_event, ctx) => {
		activeContext = ctx;
		continueAfterAbort = false;
		installEditor(ctx);
		scheduleEditorInstall(ctx);
	});

	pi.on("agent_start", (_event, ctx) => {
		activeContext = ctx;
		installEditor(ctx);
		scheduleEditorInstall(ctx);
	});

	// Also arm when something else aborts while we saw interrupt (belt + suspenders).
	pi.on("turn_end", (event, ctx) => {
		activeContext = ctx;
		if (
			event.message.role === "assistant" &&
			event.message.stopReason === "aborted" &&
			continueAfterAbort
		) {
			// keep flag; deliver on settled
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		activeContext = ctx;
		tryContinueQueued(ctx);
	});

	pi.on("session_shutdown", () => {
		if (editorInstallTimer) clearTimeout(editorInstallTimer);
		editorInstallTimer = undefined;
		activeContext = undefined;
		injectSubmit = undefined;
		continueAfterAbort = false;
	});
}
