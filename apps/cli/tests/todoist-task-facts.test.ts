import { describe, expect, it } from "bun:test";
import { todoistTaskFacts } from "../../plugin-todoist/src/client";

describe("todoistTaskFacts", () => {
	const shared = { isShared: true };
	it("omits facts for personal (unshared) projects", () => {
		expect(
			todoistTaskFacts({ responsibleUid: null }, { isShared: false }, "me"),
		).toBeUndefined();
		expect(
			todoistTaskFacts({ responsibleUid: null }, undefined, "me"),
		).toBeUndefined();
	});

	it("labels assignment in shared projects", () => {
		expect(todoistTaskFacts({ responsibleUid: "me" }, shared, "me")).toEqual({
			assignment: "you",
			shared: true,
		});
		expect(todoistTaskFacts({ responsibleUid: "sam" }, shared, "me")).toEqual({
			assignment: "someone_else",
			shared: true,
		});
		expect(todoistTaskFacts({ responsibleUid: null }, shared, "me")).toEqual({
			assignment: "unassigned",
			shared: true,
		});
		// Unknown current user: only say the list is shared.
		expect(todoistTaskFacts({ responsibleUid: "sam" }, shared, null)).toEqual({
			shared: true,
		});
	});
});
