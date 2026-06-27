import { describe, expect, it } from "bun:test";
import {
	buildSlackExternalKey,
	classifySlackInboundMessage,
	conversationFromMetadata,
	isSlackDmChannel,
	resolveSlackThreadRootTs,
	slackChannelLabel,
	slackReplyThreadTs,
	stripSlackBotMention,
} from "../src/inbound-logic";

describe("Slack inbound logic", () => {
	describe("buildSlackExternalKey", () => {
		it("builds a stable external key from team, channel, and thread", () => {
			const key = buildSlackExternalKey("T1", "C1", "123.456");
			expect(key).toBe("slack:T1:C1:123.456");
		});
	});

	describe("isSlackDmChannel", () => {
		it("identifies DM channels starting with D", () => {
			expect(isSlackDmChannel("D123")).toBe(true);
			expect(isSlackDmChannel("d123")).toBe(true);
			expect(isSlackDmChannel("C123")).toBe(false);
		});
	});

	describe("slackChannelLabel", () => {
		it("labels DM channels as DM and others as #channel", () => {
			expect(slackChannelLabel("D123")).toBe("DM");
			expect(slackChannelLabel("C123")).toBe("#C123");
		});
	});

	describe("resolveSlackThreadRootTs", () => {
		it("uses threadTs when provided for a channel", () => {
			expect(resolveSlackThreadRootTs("C1", "100", "200")).toBe("200");
		});

		it("falls back to messageTs for non-DM channels without a thread", () => {
			expect(resolveSlackThreadRootTs("C1", "100")).toBe("100");
		});

		it("uses channel id for DMs without a thread", () => {
			expect(resolveSlackThreadRootTs("D1", "100")).toBe("D1");
		});
	});

	describe("slackReplyThreadTs", () => {
		it("returns undefined for a DM whose thread root is the channel", () => {
			expect(
				slackReplyThreadTs({
					teamId: "T1",
					channelId: "D1",
					threadRootTs: "D1",
				}),
			).toBeUndefined();
		});

		it("returns the thread root for a DM with a real thread", () => {
			expect(
				slackReplyThreadTs({
					teamId: "T1",
					channelId: "D1",
					threadRootTs: "100",
				}),
			).toBe("100");
		});

		it("returns the thread root for a channel thread", () => {
			expect(
				slackReplyThreadTs({
					teamId: "T1",
					channelId: "C1",
					threadRootTs: "100",
				}),
			).toBe("100");
		});
	});

	describe("stripSlackBotMention", () => {
		it("removes the bot mention from the start of the message", () => {
			expect(stripSlackBotMention("<@U123> hello", "U123")).toBe("hello");
		});

		it("removes mentions anywhere in the message", () => {
			expect(stripSlackBotMention("hello <@U123> world", "U123")).toBe(
				"hello  world",
			);
		});
	});

	describe("classifySlackInboundMessage", () => {
		it("creates a new turn for DMs", () => {
			expect(
				classifySlackInboundMessage({
					isDm: true,
					hasThreadTs: false,
					hasExternalSession: false,
					awaitingAskUser: false,
				}),
			).toBe("new_turn");
		});

		it("ignages channel messages that are not threaded or known", () => {
			expect(
				classifySlackInboundMessage({
					isDm: false,
					hasThreadTs: false,
					hasExternalSession: false,
					awaitingAskUser: false,
				}),
			).toBe("ignore");
		});

		it("resumes askUser for known sessions awaiting a reply", () => {
			expect(
				classifySlackInboundMessage({
					isDm: false,
					hasThreadTs: true,
					hasExternalSession: true,
					awaitingAskUser: true,
				}),
			).toBe("ask_user_reply");
		});
	});

	describe("conversationFromMetadata", () => {
		it("produces a conversation with the expected external key and metadata", () => {
			const conversation = conversationFromMetadata("Slack #C1", {
				teamId: "T1",
				channelId: "C1",
				threadRootTs: "100",
				channelLabel: "#C1",
			});
			expect(conversation.externalKey).toBe("slack:T1:C1:100");
			expect(conversation.displayName).toBe("Slack #C1");
			expect(conversation.metadata).toMatchObject({
				teamId: "T1",
				channelId: "C1",
				threadRootTs: "100",
				channelLabel: "#C1",
			});
		});
	});
});
