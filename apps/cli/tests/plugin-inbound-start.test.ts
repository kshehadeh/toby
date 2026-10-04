import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getChatInboundStatus,
	resetChatInboundStatus,
	setChatInboundStatus,
} from "@toby/core/chat-inbound/status";
import { createPluginChatInboundProvider } from "@toby/core/integrations/plugins/inbound-adapter";
import { closeChatDbForTests } from "@toby/core/session-store";

let tempDir: string;
let previousTobyDir: string | undefined;

beforeEach(() => {
	previousTobyDir = process.env.TOBY_DIR;
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-inbound-start-"));
	process.env.TOBY_DIR = tempDir;
});

afterEach(() => {
	resetChatInboundStatus();
	closeChatDbForTests();
	if (previousTobyDir === undefined)
		Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = previousTobyDir;
	fs.rmSync(tempDir, { recursive: true, force: true });
});

function createProvider(script: string, bunPath = process.execPath) {
	const entryPath = path.join(tempDir, "plugin.ts");
	fs.writeFileSync(entryPath, script);
	return createPluginChatInboundProvider({
		target: { kind: "bun-package", bunPath, cwd: tempDir, entryPath },
		integrationName: "test",
		buildEnvelope: () => ({ config: {}, state: {} }),
	});
}

function start(
	provider: ReturnType<typeof createProvider>,
	signal = new AbortController().signal,
) {
	return provider.start({
		persona: { name: "Test" } as never,
		dryRun: true,
		signal,
		emit() {},
	});
}

describe("plugin inbound startup", () => {
	it("propagates missing Slack app-token errors instead of reporting connected", async () => {
		const provider = createProvider(`process.stdin.once("data", () => {
			console.log(JSON.stringify({ type: "error", message: "Slack inbound requires an app-level token (xapp-...)" }));
		});`);
		await expect(start(provider)).rejects.toThrow(
			"Slack inbound requires an app-level token",
		);
	});

	it("rejects promptly when the plugin exits without ready", async () => {
		await expect(start(createProvider("process.exit(1)"))).rejects.toThrow(
			"exited before ready",
		);
	});

	it("rejects launch failures", async () => {
		await expect(
			start(createProvider("", path.join(tempDir, "missing-bun"))),
		).rejects.toThrow();
	});

	it("allows startup to be cancelled before ready", async () => {
		const controller = new AbortController();
		const pending = start(
			createProvider("setInterval(() => {}, 1000)"),
			controller.signal,
		);
		controller.abort();
		await expect(pending).rejects.toThrow("startup aborted");
	});

	it("connects only after receiving ready and can be disposed", async () => {
		const provider = createProvider(`process.stdin.once("data", () => {
			console.log(JSON.stringify({ type: "ready" }));
		});`);
		const dispose = await start(provider);
		expect(dispose).toBeFunction();
		dispose();
	});
	it("reports a runtime process exit instead of keeping connected status", async () => {
		setChatInboundStatus({ integration: "test", status: "connected" });
		const dispose = await start(
			createProvider(`process.stdin.once("data", () => {
			console.log(JSON.stringify({ type: "ready" }));
			setTimeout(() => process.exit(1), 30);
		});`),
		);
		try {
			await waitUntil(() => getChatInboundStatus().status === "error");
			expect(getChatInboundStatus().detail).toContain("process exited");
		} finally {
			dispose();
		}
	});

	it("tracks transport reconnects and acknowledged reply delivery", async () => {
		setChatInboundStatus({ integration: "test", status: "connected" });
		const dispose = await start(
			createProvider(`process.stdin.once("data", () => {
			const emit = message => console.log(JSON.stringify(message));
			emit({ type: "ready" });
			setTimeout(() => emit({ type: "event", event: { integration: "test", externalKey: "test:thread", messageId: "1", text: "hello", authorId: "U1", isNewConversationTurn: true, conversation: { externalKey: "test:thread", displayName: "Test", metadata: {} } } }), 20);
			setTimeout(() => emit({ type: "replyDelivered", externalKey: "test:thread" }), 30);
			setTimeout(() => emit({ type: "transportState", state: "reconnecting" }), 40);
			setTimeout(() => emit({ type: "transportState", state: "connected" }), 150);
		});`),
		);
		try {
			await waitUntil(() => getChatInboundStatus().status === "connecting");
			expect(getChatInboundStatus().lastEventExternalKey).toBe("test:thread");
			expect(getChatInboundStatus().lastReplyExternalKey).toBe("test:thread");
			expect(getChatInboundStatus().lastReplyAt).toBeDefined();
			await waitUntil(() => getChatInboundStatus().status === "connected");
			expect(getChatInboundStatus().detail).toBeNull();
		} finally {
			dispose();
		}
	});
});

async function waitUntil(check: () => boolean) {
	const deadline = Date.now() + 1000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("Inbound status did not update");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
