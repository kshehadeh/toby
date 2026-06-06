import { describe, expect, it } from "vitest";
import {
	DOT_GRID_SPINNER_FRAMES,
	dotGridSpinnerFrame,
} from "../src/ui/shared/dot-grid-spinner";

describe("dotGridSpinnerFrame", () => {
	it("cycles through braille dot-grid frames", () => {
		expect(dotGridSpinnerFrame(0)).toBe(DOT_GRID_SPINNER_FRAMES[0]);
		expect(dotGridSpinnerFrame(DOT_GRID_SPINNER_FRAMES.length)).toBe(
			DOT_GRID_SPINNER_FRAMES[0],
		);
	});
});
