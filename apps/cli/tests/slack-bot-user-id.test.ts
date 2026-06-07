import { resolveSlackBotUserId } from "../../plugin-slack/src/client";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("resolveSlackBotUserId", () => {
	it("prefers auth.test over a configured human user id", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({
				ok: true,
				user_id: "U_BOT",
				user: "toby",
				team: "workspace",
			}),
		} as Response);

		const botUserId = await resolveSlackBotUserId("xoxb-test", "U_HUMAN");

		expect(botUserId).toBe("U_BOT");
		expect(fetchMock).toHaveBeenCalled();
		const [, init] = fetchMock.mock.calls[0] ?? [];
		expect((init as RequestInit).headers).toMatchObject({
			Authorization: "Bearer xoxb-test",
		});
	});

	it("falls back to configured hint when auth.test has no user id", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ ok: true }),
		} as Response);

		const botUserId = await resolveSlackBotUserId("xoxb-test", "U_FALLBACK");
		expect(botUserId).toBe("U_FALLBACK");
	});
});
