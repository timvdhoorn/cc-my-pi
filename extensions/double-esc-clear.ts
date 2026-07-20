/**
 * Double Escape clears a non-empty editor draft.
 *
 * Built-in double-Escape only acts on an *empty* editor (tree / fork / none via
 * `doubleEscapeAction`). When the editor has normal draft text, Escape is a
 * no-op while idle. This extension makes Escape → Escape (within 800ms) clear
 * that draft instead.
 *
 * A non-empty plain draft owns Esc even while the agent is streaming
 * (decided 2026-07-20): the draft must never be lost to an accidental
 * abort-and-autosubmit, so busy Esc on such a draft is swallowed here
 * rather than falling through to the app's abort handler.
 *
 * Must not steal these built-in Escape paths:
 * - bash-running abort
 * - bash-mode (`!…`) single-Esc clear/exit
 * - autocomplete cancel
 * - empty / whitespace-only double-Esc (`doubleEscapeAction`)
 * - streaming abort, when the draft is empty/bash-mode
 *
 * Vendored from @thisux/pi-double-esc-clear v1.0.3 (MIT, author Sanju
 * <https://sanju.sh/>). Exposed as a register function gated by a live
 * `isEnabled` getter so the /cc-tools settings toggle takes effect without a
 * Pi reload. Adds an `EDITOR_FEATURES` marker (absent in the standalone
 * package) so a second bundled install does not double-wrap.
 *
 * First Esc also shows a transient, right-aligned "Esc again to clear" hint
 * above the editor, auto-hiding after the second-Esc window (or sooner on
 * clear / other input).
 */
import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

/** Second-Esc accept window — also how long the hint stays visible. */
const DOUBLE_ESC_MS = 2_000;

const EDITOR_FEATURES = Symbol.for("@tmustier/pi-editor-features");
const FEATURE = "double-esc-clear";

const HINT_WIDGET_KEY = "cc-tools-double-esc-hint";
const HINT_TEXT = "Esc again to clear";

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;
type ComposedEditorFactory = EditorFactory & { [EDITOR_FEATURES]?: ReadonlySet<string> };

function editorFeatures(factory: EditorFactory | undefined): ReadonlySet<string> {
	return (factory as ComposedEditorFactory | undefined)?.[EDITOR_FEATURES] ?? new Set();
}

/** Draft Pi would leave alone on Escape (not empty, not `!` bash mode). */
function isClearableDraft(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length === 0) return false;
	// Bash mode is exited with a single Escape by the app.
	if (text.trimStart().startsWith("!")) return false;
	return true;
}

export function registerBundledDoubleEscClear(
	pi: ExtensionAPI,
	isEnabled: () => boolean,
): void {
	let hintTimer: ReturnType<typeof setTimeout> | undefined;
	let hintCtx: ExtensionContext | undefined;

	const hideHint = (): void => {
		if (hintTimer) clearTimeout(hintTimer);
		hintTimer = undefined;
		hintCtx?.ui.setWidget(HINT_WIDGET_KEY, undefined);
		hintCtx = undefined;
	};

	const showHint = (ctx: ExtensionContext): void => {
		hideHint();
		hintCtx = ctx;
		ctx.ui.setWidget(
			HINT_WIDGET_KEY,
			() => ({
				render(width: number): string[] {
					const pad = Math.max(0, width - HINT_TEXT.length);
					return [`${" ".repeat(pad)}\x1b[2m${HINT_TEXT}\x1b[0m`];
				},
				invalidate(): void {
					// Static content; nothing to invalidate.
				},
			}),
			{ placement: "aboveEditor" },
		);
		hintTimer = setTimeout(hideHint, DOUBLE_ESC_MS);
	};

	let installTimer: ReturnType<typeof setTimeout> | undefined;

	const installEditor = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;

		const previous = ctx.ui.getEditorComponent();
		const features = editorFeatures(previous);
		// Dedup: we are already in this factory chain.
		if (features.has(FEATURE)) return;

		const factory = ((tui, theme, keybindings: KeybindingsManager) => {
			const editor = (previous?.(tui, theme, keybindings) ??
				new CustomEditor(tui, theme, keybindings)) as CustomEditor;

			// Capability check instead of instanceof: other extensions (e.g.
			// pi-raw-paste) build their editor from a DIFFERENT copy of
			// pi-coding-agent (cc-tools ships its own node_modules), so
			// `instanceof CustomEditor` is false cross-realm even though the
			// editor is fully compatible — and the feature silently died.
			if (
				typeof editor.getText !== "function" ||
				typeof editor.setText !== "function" ||
				typeof editor.isShowingAutocomplete !== "function" ||
				typeof editor.handleInput !== "function"
			) {
				return editor;
			}

			// Framework rebinds onEscape after the factory returns, so intercept
			// handleInput rather than assigning onEscape here.
			const originalHandleInput = editor.handleInput.bind(editor);
			let lastEscapeTime = 0;

			editor.handleInput = (data: string) => {
				const isEscape =
					typeof keybindings.matches === "function"
						? keybindings.matches(data, "app.interrupt")
						: matchesKey(data, "escape");

				if (
					isEscape &&
					isEnabled() &&
					!editor.isShowingAutocomplete() &&
					isClearableDraft(editor.getText())
				) {
					const now = Date.now();
					if (now - lastEscapeTime < DOUBLE_ESC_MS) {
						// Second Esc on a plain draft → clear. Never falls through.
						editor.setText("");
						lastEscapeTime = 0;
						hideHint();
						return;
					}
					lastEscapeTime = now;
					showHint(ctx);
					if (ctx.isIdle()) {
						// Idle: fall through so bash-running / other app Escape
						// handlers still run when applicable.
						originalHandleInput(data);
					}
					// Busy: swallow — falling through would abort the run; the
					// draft must never cost the user their running turn.
					return;
				}

				if (!isEscape) {
					lastEscapeTime = 0;
					if (hintTimer) hideHint();
				}

				originalHandleInput(data);
			};

			return editor;
		}) as ComposedEditorFactory;
		factory[EDITOR_FEATURES] = new Set([...features, FEATURE]);
		ctx.ui.setEditorComponent(factory);
	};

	// Some extensions (e.g. pi-raw-paste) REPLACE the editor factory at
	// session_start without chaining the previous one, and handler order is
	// not guaranteed — a single immediate install can be silently discarded.
	// Install immediately AND on a later tick (and again on agent_start),
	// like esc-steer/queue-steer do; the EDITOR_FEATURES marker makes
	// re-installs idempotent.
	const scheduleInstall = (ctx: ExtensionContext): void => {
		if (installTimer) clearTimeout(installTimer);
		installTimer = setTimeout(() => {
			installTimer = undefined;
			installEditor(ctx);
		}, 0);
	};

	pi.on("session_start", (_event, ctx) => {
		installEditor(ctx);
		scheduleInstall(ctx);
	});

	pi.on("agent_start", (_event, ctx) => {
		installEditor(ctx);
		scheduleInstall(ctx);
	});

	pi.on("session_shutdown", () => {
		if (installTimer) clearTimeout(installTimer);
		installTimer = undefined;
		hideHint();
	});
}
