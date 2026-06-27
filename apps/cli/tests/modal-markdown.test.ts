import { describe, expect, it } from "bun:test";
import {
	parseModalInlinePieces,
	splitStatusGlyphPrefix,
} from "../src/ui/chat/modal-markdown";

describe("splitStatusGlyphPrefix", () => {
	it("splits connected plugin lines", () => {
		expect(
			splitStatusGlyphPrefix("✔︎ **Azure AD** · connected · v1.0.0"),
		).toEqual({
			indent: "",
			glyph: "✔︎",
			glyphColor: "green",
			body: "**Azure AD** · connected · v1.0.0",
		});
	});

	it("splits disconnected plugin lines", () => {
		expect(splitStatusGlyphPrefix("✗ **Sample** · disconnected")).toEqual({
			indent: "",
			glyph: "✗",
			glyphColor: "red",
			body: "**Sample** · disconnected",
		});
	});
});

describe("parseModalInlinePieces", () => {
	it("colors status words and preserves bold plugin names", () => {
		expect(parseModalInlinePieces("**Azure AD** · connected · v1.0.0")).toEqual(
			[
				{ bold: true, italic: false, text: "Azure AD" },
				{ bold: false, italic: false, text: " · " },
				{ bold: false, italic: false, text: "connected", color: "green" },
				{ bold: false, italic: false, text: " · v1.0.0" },
			],
		);
	});
});
