import { describe, expect, it } from "bun:test";
import { resolveChatAttachmentCapability } from "@toby/core/ai/model-capabilities";
import { validateChatAttachments } from "@toby/core/chat-pipeline/attachments";
import { assembleMessagesNode } from "@toby/core/chat-pipeline/nodes/assemble-messages";
import { persistTurnNode } from "@toby/core/chat-pipeline/nodes/persist-turn";
import type {
	ExpandedTurn,
	RanTurn,
	TurnContext,
} from "@toby/core/chat-pipeline/pipeline";
import type { Persona } from "@toby/core/config/index";

function persona(provider: string, model: string): Persona {
	return {
		name: "Test",
		instructions: "",
		promptMode: "add",
		ai: { provider, model },
	};
}

describe("chat attachment model capabilities", () => {
	it("enables supported OpenAI direct models", () => {
		expect(
			resolveChatAttachmentCapability(persona("openai", "gpt-5-mini"))
				.supported,
		).toBe(true);
		expect(
			resolveChatAttachmentCapability(persona("openai", "gpt-4.1")).supported,
		).toBe(true);
		expect(
			resolveChatAttachmentCapability(persona("openai", "gpt-4o")).supported,
		).toBe(true);
		expect(
			resolveChatAttachmentCapability(persona("openai", "o3")).supported,
		).toBe(true);
		expect(
			resolveChatAttachmentCapability(persona("openai", "o4-mini")).supported,
		).toBe(true);
	});

	it("enables known multimodal Vercel Gateway model families", () => {
		expect(
			resolveChatAttachmentCapability(persona("vercel", "openai/gpt-5-mini"))
				.supported,
		).toBe(true);
		expect(
			resolveChatAttachmentCapability(
				persona("vercel", "anthropic/claude-sonnet-4.6"),
			).supported,
		).toBe(true);
		expect(
			resolveChatAttachmentCapability(
				persona("vercel", "google/gemini-2.5-flash"),
			).supported,
		).toBe(true);
	});

	it("disables unknown gateway custom models and Ollama", () => {
		expect(
			resolveChatAttachmentCapability(persona("vercel", "meta/llama-4-scout"))
				.supported,
		).toBe(false);
		expect(
			resolveChatAttachmentCapability(persona("ollama", "llama3.2")).supported,
		).toBe(false);
	});

	it("allows project attachment storage for models that cannot inspect files", () => {
		expect(() =>
			validateChatAttachments(
				[
					{
						filename: "brief.pdf",
						mediaType: "application/pdf",
						dataBase64: "aGVsbG8=",
						byteSize: 5,
					},
				],
				persona("ollama", "llama3.2"),
				{ allowUnsupportedModel: true, allowAnyMediaType: true },
			),
		).not.toThrow();
	});

	it("strips file bytes from persisted message history", async () => {
		const result = await persistTurnNode.run(
			{
				rawUserText: "summarize",
				effectiveText: "summarize",
				attachments: [
					{
						filename: "notes.txt",
						mediaType: "text/plain",
						dataBase64: "aGVsbG8=",
						byteSize: 5,
					},
				],
				messages: [
					{ role: "system", content: "sys" },
					{
						role: "user",
						content: [
							{ type: "text", text: "summarize" },
							{
								type: "file",
								filename: "notes.txt",
								mediaType: "text/plain",
								data: "aGVsbG8=",
							},
						],
					},
				],
				responseMessages: [{ role: "assistant", content: "done" }],
				text: "done",
				toolCalls: [],
				appliedActions: [],
				priorMessages: [],
				isFirstTurn: false,
				localSkills: [],
				toolCatalog: {},
				willPretreat: false,
				integrationLabel: "",
				routingIndex: null,
				spec: null,
				prepId: null,
			} as unknown as RanTurn,
			{
				emit: () => {},
				nextSeq: () => 1,
				persona: persona("openai", "gpt-5-mini"),
				modules: [],
				dryRun: false,
				emitPersistLifecycle: false,
			} as unknown as TurnContext,
		);

		expect(result.messagesAfterTurn[1]).toEqual({
			role: "user",
			content: "summarize\n\nAttachments: notes.txt (text/plain, 5 bytes)",
		});
		expect(JSON.stringify(result.messagesAfterTurn)).not.toContain("aGVsbG8=");
	});
});

describe("chat attachment message assembly", () => {
	it("keeps text-only turns unchanged", async () => {
		const result = await assembleMessagesNode.run(
			{
				rawUserText: "hello",
				effectiveText: "hello",
				attachments: [],
				priorMessages: [{ role: "system", content: "sys" }],
				isFirstTurn: false,
				localSkills: [],
				toolCatalog: {},
				willPretreat: false,
				integrationLabel: "",
				routingIndex: null,
				spec: null,
				prepId: null,
			} as unknown as ExpandedTurn,
			{
				emit: () => {},
				nextSeq: () => 1,
				persona: persona("openai", "gpt-5-mini"),
				modules: [],
				dryRun: false,
				emitPersistLifecycle: false,
			} as unknown as TurnContext,
		);
		expect(result.messages.at(-1)).toEqual({ role: "user", content: "hello" });
	});

	it("adds AI SDK file parts to attached turns", async () => {
		const result = await assembleMessagesNode.run(
			{
				rawUserText: "summarize",
				effectiveText: "summarize",
				attachments: [
					{
						filename: "notes.txt",
						mediaType: "text/plain",
						dataBase64: "aGVsbG8=",
						byteSize: 5,
					},
				],
				priorMessages: [{ role: "system", content: "sys" }],
				isFirstTurn: false,
				localSkills: [],
				toolCatalog: {},
				willPretreat: false,
				integrationLabel: "",
				routingIndex: null,
				spec: null,
				prepId: null,
			} as unknown as ExpandedTurn,
			{
				emit: () => {},
				nextSeq: () => 1,
				persona: persona("openai", "gpt-5-mini"),
				modules: [],
				dryRun: false,
				emitPersistLifecycle: false,
			} as unknown as TurnContext,
		);

		expect(result.messages.at(-1)).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "summarize" },
				{
					type: "file",
					filename: "notes.txt",
					mediaType: "text/plain",
					data: "aGVsbG8=",
				},
			],
		});
	});

	it("lists files as text when the model cannot inspect their contents", async () => {
		const result = await assembleMessagesNode.run(
			{
				rawUserText: "Save this to the project",
				effectiveText: "Save this to the project",
				attachments: [
					{
						filename: "brief.pdf",
						mediaType: "application/pdf",
						dataBase64: "aGVsbG8=",
						byteSize: 5,
					},
				],
				priorMessages: [{ role: "system", content: "sys" }],
				isFirstTurn: false,
				localSkills: [],
				toolCatalog: {},
				willPretreat: false,
				integrationLabel: "",
				routingIndex: null,
				spec: null,
				prepId: null,
			} as unknown as ExpandedTurn,
			{
				emit: () => {},
				nextSeq: () => 1,
				persona: persona("ollama", "llama3.2"),
				modules: [],
				dryRun: false,
				emitPersistLifecycle: false,
			} as unknown as TurnContext,
		);

		expect(result.messages.at(-1)).toEqual({
			role: "user",
			content:
				"Save this to the project\n\nAttachments: brief.pdf (application/pdf, 5 bytes)",
		});
	});
});
