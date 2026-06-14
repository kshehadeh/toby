import { describe, expect, it } from "vitest";
import {
	TURN_CANCELLATION_NOTICE,
	buildTurnCancellationNoticeEntry,
} from "../src/ui/chat/session-note";

describe("buildTurnCancellationNoticeEntry", () => {
	it("returns an info notice with the cancellation message", () => {
		const entry = buildTurnCancellationNoticeEntry(null);
		expect(entry).toEqual({
			kind: "notice",
			text: TURN_CANCELLATION_NOTICE,
			tone: "info",
		});
	});
});
