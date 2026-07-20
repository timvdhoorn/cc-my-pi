import assert from "node:assert/strict";
import test from "node:test";
import {
	PI_MASCOT_FRAME_COUNT,
	PI_MASCOT_ROW_COUNT,
	PI_MASCOT_WIDTH,
	piMascotFrame,
} from "./pi-mascot.ts";

const idPaint = { accent: (s: string) => s, muted: (s: string) => s };

/** Visible width ignoring painted ANSI (none here, but strip to be safe). */
function visibleLen(text: string): number {
	return [...text.replace(/\x1b\[[0-9;]*m/g, "")].length;
}

test("frame count is at least 10 and matches the exported constant", () => {
	assert.ok(PI_MASCOT_FRAME_COUNT >= 10, "enough frames for a build-up + blink");
});

test("every frame has a fixed row count and each row is the same visible width", () => {
	for (let i = 0; i < PI_MASCOT_FRAME_COUNT; i++) {
		const rows = piMascotFrame(i, idPaint);
		assert.equal(rows.length, PI_MASCOT_ROW_COUNT, `frame ${i} row count`);
		for (const row of rows) {
			assert.equal(visibleLen(row), PI_MASCOT_WIDTH, `frame ${i} row width`);
		}
	}
});

test("the mascot never jitters: row widths are identical across all frames", () => {
	const widths = new Set<string>();
	for (let i = 0; i < PI_MASCOT_FRAME_COUNT; i++) {
		widths.add(piMascotFrame(i, idPaint).map((r) => visibleLen(r)).join(","));
	}
	assert.equal(widths.size, 1, "all frames share one width signature");
});

test("blink toggles the bar row (open ≠ closed)", () => {
	// Frame 3 opens the eyes; frame 4 blinks them closed.
	const open = piMascotFrame(3, idPaint)[0];
	const closed = piMascotFrame(4, idPaint)[0];
	assert.notEqual(open, closed, "bar row differs between open and closed eyes");
});

test("the final frame differs from the first and is painted with accent", () => {
	const first = piMascotFrame(0, idPaint).join("\n");
	const last = piMascotFrame(PI_MASCOT_FRAME_COUNT - 1, idPaint).join("\n");
	assert.notEqual(first, last, "final pose differs from the initial build-up frame");

	let accentCalls = 0;
	const spyPaint = { accent: (s: string) => (accentCalls++, s), muted: (s: string) => s };
	piMascotFrame(PI_MASCOT_FRAME_COUNT - 1, spyPaint);
	assert.ok(accentCalls > 0, "final frame paints with the brand accent");
});

test("frame 0 (closed eyes, no legs) makes no accent calls", () => {
	let accentCalls = 0;
	const spyPaint = { accent: (s: string) => (accentCalls++, s), muted: (s: string) => s };
	piMascotFrame(0, spyPaint);
	assert.equal(accentCalls, 0, "the initial frame is fully muted");
});
