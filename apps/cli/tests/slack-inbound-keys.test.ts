import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSlackPostToken } from "@toby/core/integrations/slack/client";
import {
	buildSlackExternalKey,
	classifySlackInboundMessage,
	isSlackDmChannel,
	resolveSlackThreadRootTs,
	slackReplyThreadTs,
	stripSlackBotMention,
} from "@toby/core/integrations/slack/inbound";
import { afterEach, describe, expect, it } from "vitest";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-slack-thread-"));
}

function writeCredentials(data: object): void {
	const dir = process.env.TOBY_DIR;
	if (!dir) {
		throw new Error("TOBY_DIR is not set");
	}
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "credentials.json"),
		JSON.stringify(data, null, 2),
	);
}

afterEach(() => {
	const dir = process.env.TOBY_DIR;
	if (dir && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	process.env.TOBY_DIR = undefined;
});

describe("slack inbound helpers", () => {
	it("builds stable external keys", () => {
		expect(buildSlackExternalKey("T1", "C1", "123.456")).toBe(
			"slack:T1:C1:123.456",
		);
	});

	it("strips bot mention from text", () => {
		expect(stripSlackBotMention("<@U123> hello there", "U123")).toBe(
			"hello there",
		);
		expect(stripSlackBotMention("  <@U123>   ping  ", "U123")).toBe("ping");
	});

	it("detects DM channels", () => {
		expect(isSlackDmChannel("D08ABCDEF")).toBe(true);
		expect(isSlackDmChannel("C25N10GHL")).toBe(false);
	});

	it("uses stable thread root for DMs", () => {
		expect(resolveSlackThreadRootTs("D08ABCDEF", "111.222", undefined)).toBe(
			"D08ABCDEF",
		);
		expect(resolveSlackThreadRootTs("C1", "111.222", undefined)).toBe(
			"111.222",
		);
	});

	it("omits thread_ts for top-level DM replies", () => {
		expect(
			slackReplyThreadTs({
				teamId: "T1",
				channelId: "D08ABCDEF",
				threadRootTs: "D08ABCDEF",
			}),
		).toBeUndefined();
	});

	it("handles DM messages without an existing session", () => {
		expect(
			classifySlackInboundMessage({
				isDm: true,
				hasThreadTs: false,
				hasExternalSession: false,
				awaitingAskUser: false,
			}),
		).toBe("new_turn");
	});

	it("still requires a channel thread session for non-DM follow-ups", () => {
		expect(
			classifySlackInboundMessage({
				isDm: false,
				hasThreadTs: false,
				hasExternalSession: true,
				awaitingAskUser: false,
			}),
		).toBe("ignore");
		expect(
			classifySlackInboundMessage({
				isDm: false,
				hasThreadTs: true,
				hasExternalSession: true,
				awaitingAskUser: false,
			}),
		).toBe("new_turn");
	});

	it("prefers bot token for posting when user oauth is also configured", () => {
		process.env.TOBY_DIR = makeTempDir();
		writeCredentials({
			integrations: {
				slack: {
					authMethod: "oauth",
					oauthUserToken: "xoxp-user",
					oauthBotToken: "xoxb-bot",
				},
			},
		});
		expect(resolveSlackPostToken()).toBe("xoxb-bot");
	});
});
