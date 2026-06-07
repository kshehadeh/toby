import { buildSlackStatusContextBlocks } from "../../plugin-slack/src/slack-markdown";
import { formatSlackInboundStatusMrkdwn } from "@toby/core/integrations/plugins/inbound-slack-status-format";
import { slackStatusPlainFallback } from "../../plugin-slack/src/status-format";
import { describe, expect, it } from "vitest";

describe("formatSlackInboundStatusMrkdwn", () => {
	it("wraps prep lines with emoji and italic mrkdwn", () => {
		expect(
			formatSlackInboundStatusMrkdwn({
				type: "prep_start",
				id: "p1",
				seq: 1,
				header: "Expand",
			}),
		).toBe("⏳ _Expand…_");
	});

	it("uses tool-specific emoji for tool_call_start", () => {
		expect(
			formatSlackInboundStatusMrkdwn({
				type: "tool_call_start",
				blockKey: "t1",
				seq: 2,
				toolName: "getRecentEmails",
				args: {},
			}),
		).toBe("📧 _Calling fetch recent unread emails…_");
	});

	it("uses askUser emoji", () => {
		expect(
			formatSlackInboundStatusMrkdwn({
				type: "tool_call_start",
				blockKey: "t2",
				seq: 3,
				toolName: "askUser",
				args: {},
			}),
		).toBe("❓ _Waiting for your choice…_");
	});

	it("uses sparkle emoji for ready-for-model", () => {
		expect(
			formatSlackInboundStatusMrkdwn({
				type: "prep_end",
				id: "p2",
				seq: 2,
				detail: "done",
			}),
		).toBe("✨ _Ready for model…_");
	});

	it("uses rocket emoji for plan phase execution", () => {
		expect(
			formatSlackInboundStatusMrkdwn({
				type: "plan_phase_start",
				planId: "pl1",
				phaseId: "ph1",
				seq: 5,
				label: "Fetch inbox",
				index: 0,
				total: 2,
			}),
		).toBe("🚀 _Executing phase 1/2: Fetch inbox_");
	});

	it("returns null when there is no footer line", () => {
		expect(
			formatSlackInboundStatusMrkdwn({
				type: "assistant_text_delta",
				segmentId: "s1",
				seq: 4,
				delta: "x",
			}),
		).toBeNull();
	});
});

describe("slack status blocks", () => {
	it("uses context block for dimmed rendering", () => {
		const blocks = JSON.parse(
			buildSlackStatusContextBlocks("⏳ _Preparing request…_"),
		) as Array<{
			type: string;
			elements: Array<{ type: string; text: string }>;
		}>;
		expect(blocks[0]?.type).toBe("context");
		expect(blocks[0]?.elements[0]?.text).toBe("⏳ _Preparing request…_");
	});

	it("strips italic markers for plain fallback", () => {
		expect(slackStatusPlainFallback("📧 _Calling Gmail…_")).toBe(
			"📧 Calling Gmail…",
		);
	});
});
