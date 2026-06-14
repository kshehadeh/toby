import { afterEach, describe, expect, it, vi } from "vitest";
import { postSlackMessage } from "../../plugin-slack/src/client";

describe("postSlackMessage", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("converts markdown before using the markdown_text fallback", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: false, error: "invalid_blocks" }), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true, channel: "C123", ts: "1.2" }), {
					status: 200,
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		await postSlackMessage({
			config: {},
			channel: "C123",
			text: "## Heading\n\n**Bold** text",
			token: "xoxb-test",
		});

		const fallbackBody = fetchMock.mock.calls[1]?.[1]?.body as URLSearchParams;
		expect(fallbackBody.get("markdown_text")).toBe("*Heading*\n\n*Bold* text");
	});
});
