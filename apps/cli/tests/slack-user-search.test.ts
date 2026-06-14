import { describe, expect, it } from "vitest";
import type { SlackUser } from "../../plugin-slack/src/client";

describe("Slack user search helpers", () => {
	const sampleUser: SlackUser = {
		id: "U123",
		name: "jdoe",
		realName: "Jane Doe",
		displayName: "Jane",
		email: "jane@example.com",
		isBot: false,
	};

	it("matches by name, display name, and email", () => {
		const matches = (user: SlackUser, q: string) => {
			const queryLower = q.toLowerCase();
			const haystack = [
				user.name,
				user.realName,
				user.displayName,
				user.email,
				user.id,
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			return haystack.includes(queryLower);
		};

		expect(matches(sampleUser, "jane")).toBe(true);
		expect(matches(sampleUser, "jdoe")).toBe(true);
		expect(matches(sampleUser, "jane@example.com")).toBe(true);
		expect(matches(sampleUser, "unknown")).toBe(false);
	});
});
