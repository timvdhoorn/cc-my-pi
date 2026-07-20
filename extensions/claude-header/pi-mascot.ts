/**
 * Animated π mascot for the startup header (original cc-my-pi work, plan 031).
 *
 * Concept B — "the π IS the poppetje": a top bar (the π stroke) with two legs
 * and two eyes sitting on the bar, drawn in fine half-block glyphs (never the
 * old `███` cells). The timeline builds the creature up, blinks twice, then
 * settles into a brand-accent pose:
 *
 *   frames 0–3  build-up  (bar → one leg → two legs → feet + eyes open)
 *   frames 4–8  blink      (closed → open → closed → open → open)
 *   frames 9–12 accent     (full pose painted with the brand accent)
 *
 * Every frame returns exactly ROW_COUNT rows and every row has the SAME visible
 * width across ALL frames, so the header never jitters as the animation plays.
 */
export type MascotPaint = {
	accent: (s: string) => string;
	muted: (s: string) => string;
};

/** Total animation frames (matches the 120 ms header interval → ~1.5s). */
export const PI_MASCOT_FRAME_COUNT = 13;

/** Fixed visible width of every mascot row. */
export const PI_MASCOT_WIDTH = 11;

/** Rows emitted every frame (bar + two leg rows + feet). */
export const PI_MASCOT_ROW_COUNT = 4;

// Raw glyph rows (unpainted). All exactly PI_MASCOT_WIDTH characters wide.
const BAR_BASE = "▐█████████▌"; // eyes closed (solid full-height bar)
const LEG_ROW = " ▐██▌ ▐██▌ ";
const FEET_ROW = " ▝██▘ ▝██▙ "; // right foot curls (classic π)
const BLANK = " ".repeat(PI_MASCOT_WIDTH);

/** Column indices on the bar row where the two eyes sit. */
const EYE_COLS = [3, 7] as const;
/** Glyph an open eye shows as (lower-half block leaves a notch in the bar top). */
const EYE_OPEN_GLYPH = "▄";

interface FrameSpec {
	legRows: 0 | 1 | 2;
	feet: boolean;
	eyeOpen: boolean;
	accent: boolean;
}

const FRAMES: FrameSpec[] = [
	// build-up
	{ legRows: 0, feet: false, eyeOpen: false, accent: false },
	{ legRows: 1, feet: false, eyeOpen: false, accent: false },
	{ legRows: 2, feet: false, eyeOpen: false, accent: false },
	{ legRows: 2, feet: true, eyeOpen: true, accent: false },
	// blink twice: closed → open → closed → open → open
	{ legRows: 2, feet: true, eyeOpen: false, accent: false },
	{ legRows: 2, feet: true, eyeOpen: true, accent: false },
	{ legRows: 2, feet: true, eyeOpen: false, accent: false },
	{ legRows: 2, feet: true, eyeOpen: true, accent: false },
	{ legRows: 2, feet: true, eyeOpen: true, accent: false },
	// settle into the brand-accent pose
	{ legRows: 2, feet: true, eyeOpen: true, accent: true },
	{ legRows: 2, feet: true, eyeOpen: true, accent: true },
	{ legRows: 2, feet: true, eyeOpen: true, accent: true },
	{ legRows: 2, feet: true, eyeOpen: true, accent: true },
];

function paintBar(spec: FrameSpec, paint: MascotPaint): string {
	const chars = BAR_BASE.split("");
	if (spec.eyeOpen) for (const c of EYE_COLS) chars[c] = EYE_OPEN_GLYPH;
	return chars
		.map((ch, i) => {
			if (spec.accent) return paint.accent(ch);
			// Only an OPEN eye gets the accent highlight; closed eyes melt into the
			// muted bar (so frame 0 makes no accent calls).
			if (spec.eyeOpen && (EYE_COLS as readonly number[]).includes(i)) return paint.accent(ch);
			return paint.muted(ch);
		})
		.join("");
}

function paintRow(base: string, spec: FrameSpec, paint: MascotPaint): string {
	if (base === BLANK) return base;
	return spec.accent ? paint.accent(base) : paint.muted(base);
}

/**
 * Render one mascot frame as PI_MASCOT_ROW_COUNT rows, each PI_MASCOT_WIDTH wide
 * (before painting; ANSI colors do not change visible width).
 */
export function piMascotFrame(frameIndex: number, paint: MascotPaint): string[] {
	const spec = FRAMES[((frameIndex % FRAMES.length) + FRAMES.length) % FRAMES.length]!;
	return [
		paintBar(spec, paint),
		paintRow(spec.legRows >= 1 ? LEG_ROW : BLANK, spec, paint),
		paintRow(spec.legRows >= 2 ? LEG_ROW : BLANK, spec, paint),
		paintRow(spec.feet ? FEET_ROW : BLANK, spec, paint),
	];
}
