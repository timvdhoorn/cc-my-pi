/**
 * Header render helpers. Originally vendored from pi-claude-code-tui's
 * `render-utils.ts`; the file is now part of the FORKED claude-header module
 * (see ./index.ts for attribution). `formatCwd`/`formatModelLabel`/
 * `formatThinkingLabel`/`center`/`padRight` keep their upstream bodies; the
 * command-tip machinery was dropped in plan 031 and `headerColumnWidths` was
 * flipped to Claude Code proportions (narrow left, wide right).
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function formatCwd(cwd: string, home = process.env.HOME): string {
	return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

/** Prefer `provider/id` when available (matches other pi extension examples). */
export function formatModelLabel(model: { provider?: string; id?: string } | null | undefined): string {
	if (!model?.id) return "Default model";
	return model.provider ? `${model.provider}/${model.id}` : model.id;
}

export function formatThinkingLabel(level: string): string {
	return level === "off" ? "off" : level;
}

export function center(text: string, width: number): string {
	if (width <= 0) return "";
	const w = visibleWidth(text);
	if (w >= width) return truncateToWidth(text, width, "…");
	return `${" ".repeat(Math.floor((width - w) / 2))}${text}`;
}

export function padRight(text: string, width: number, ellipsis = ""): string {
	const clipped = truncateToWidth(text, width, ellipsis);
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/**
 * Claude Code proportions: a narrow left column (mascot + model/cwd) and a wide
 * right column (Getting started + Loaded). This is the inverse of the vendored
 * layout, which made the logo the hero — flipped in plan 031.
 */
/** Narrowest left column that still fits the π mascot (~12 wide + breathing room). */
export const MIN_LEFT_WIDTH = 24;
/** Cap the left column; long model strings truncate with `…` via `center`. */
export const MAX_LEFT_WIDTH = 44;
/** Narrowest right column; below this the right column is hidden. */
export const MIN_RIGHT_WIDTH = 24;
const COLUMN_GAP = 3; // ` ${divider} `

/**
 * Layout widths for the startup header body (Claude Code proportions).
 *
 * - Left column ≈ 30% of `innerWidth`, clamped to [MIN_LEFT_WIDTH, MAX_LEFT_WIDTH].
 * - Right column gets the rest minus the 3-char gap and is ALWAYS the wider
 *   column when shown.
 * - Narrow: below MIN_LEFT_WIDTH + gap + MIN_RIGHT_WIDTH, drop the right column
 *   and give the left column the full inner width.
 */
export function headerColumnWidths(
	innerWidth: number,
	minLeftWidth = MIN_LEFT_WIDTH,
	maxLeftWidth = MAX_LEFT_WIDTH,
	minRightWidth = MIN_RIGHT_WIDTH,
): { leftWidth: number; rightWidth: number; useRight: boolean } {
	if (innerWidth <= 0) {
		return { leftWidth: 0, rightWidth: 0, useRight: false };
	}

	const gap = COLUMN_GAP;
	const single = { leftWidth: innerWidth, rightWidth: 0, useRight: false };
	if (innerWidth < minLeftWidth + gap + minRightWidth) return single;

	// Narrow left column ≈ 30%; the right column absorbs the remaining width.
	const leftWidth = Math.min(maxLeftWidth, Math.max(minLeftWidth, Math.round(innerWidth * 0.3)));
	const rightWidth = innerWidth - gap - leftWidth;

	// Right must clear its minimum, stay strictly wider than the left, and never
	// starve the left below its minimum — otherwise fall back to a single column.
	if (rightWidth < minRightWidth || rightWidth <= leftWidth || leftWidth < minLeftWidth) {
		return single;
	}

	return { leftWidth, rightWidth, useRight: true };
}
