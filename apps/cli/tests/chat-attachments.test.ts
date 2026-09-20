import { describe, expect, it } from "bun:test";
import { resolveChatAttachmentCapability } from "@toby/core/ai/model-capabilities";
import {
	chatAttachmentsToFileParts,
	formatInlineTextAttachments,
	sanitizeModelMessagesForProvider,
	validateChatAttachments,
} from "@toby/core/chat-pipeline/attachments";
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

	it("allows PDF attachments on models that cannot inspect files", () => {
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
			),
		).not.toThrow();
	});

	it("allows markdown attachments on models that cannot inspect files", () => {
		expect(() =>
			validateChatAttachments(
				[
					{
						filename: "notes.md",
						mediaType: "text/markdown",
						dataBase64: "aGVsbG8=",
						byteSize: 5,
					},
				],
				persona("ollama", "llama3.2"),
			),
		).not.toThrow();
	});

	it("still rejects images on models that cannot inspect files", () => {
		expect(() =>
			validateChatAttachments(
				[
					{
						filename: "photo.png",
						mediaType: "image/png",
						dataBase64: "aGVsbG8=",
						byteSize: 5,
					},
				],
				persona("ollama", "llama3.2"),
			),
		).toThrow(
			/disabled by default|not configured as supporting file attachments/,
		);
	});

	it("strips file bytes without duplicating a model-visible attachment summary", async () => {
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
							{
								type: "text",
								text: "summarize\n\nAttachments: notes.txt (text/plain, 5 bytes)",
							},
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

	it("exposes filenames in text alongside AI SDK image file parts", async () => {
		const result = await assembleMessagesNode.run(
			{
				rawUserText: "summarize",
				effectiveText: "summarize",
				attachments: [
					{
						filename: "reference-image.png",
						mediaType: "image/png",
						dataBase64: "aGVsbG8=",
						byteSize: 5,
					},
					{
						filename: "wireframe.jpg",
						mediaType: "image/jpeg",
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
				{
					type: "text",
					text: "summarize\n\nAttachments: reference-image.png (image/png, 5 bytes), wireframe.jpg (image/jpeg, 5 bytes)",
				},
				{
					type: "file",
					filename: "reference-image.png",
					mediaType: "image/png",
					data: "aGVsbG8=",
				},
				{
					type: "file",
					filename: "wireframe.jpg",
					mediaType: "image/jpeg",
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

	it("inlines markdown as text instead of an unsupported file part", async () => {
		const markdown = "# Plan\nShip it.";
		const dataBase64 = Buffer.from(markdown, "utf8").toString("base64");
		const result = await assembleMessagesNode.run(
			{
				rawUserText: "Add this to my library",
				effectiveText: "Add this to my library",
				attachments: [
					{
						filename: "notes.md",
						mediaType: "text/markdown",
						dataBase64,
						byteSize: Buffer.from(markdown, "utf8").byteLength,
					},
					{
						filename: "deck.pptx",
						mediaType:
							"application/vnd.openxmlformats-officedocument.presentationml.presentation",
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

		const last = result.messages.at(-1);
		expect(last?.role).toBe("user");
		expect(typeof last?.content).toBe("string");
		const text = String(last?.content);
		expect(text).toContain("Add this to my library");
		expect(text).toContain("notes.md (text/markdown");
		expect(text).toContain("# Plan\nShip it.");
		expect(text).toContain("deck.pptx");
		expect(JSON.stringify(last)).not.toContain('"type":"file"');
	});
});

describe("chatAttachmentsToFileParts", () => {
	it("emits native image and PDF parts only", () => {
		const parts = chatAttachmentsToFileParts([
			{
				filename: "notes.md",
				mediaType: "text/markdown",
				dataBase64: "YQ==",
				byteSize: 1,
			},
			{
				filename: "photo.png",
				mediaType: "image/png",
				dataBase64: "aGVsbG8=",
				byteSize: 5,
			},
			{
				filename: "deck.pptx",
				mediaType:
					"application/vnd.openxmlformats-officedocument.presentationml.presentation",
				dataBase64: "aGVsbG8=",
				byteSize: 5,
			},
			{
				filename: "brief.pdf",
				mediaType: "application/pdf",
				dataBase64: "aGVsbG8=",
				byteSize: 5,
			},
		]);
		expect(parts).toEqual([
			{
				type: "file",
				filename: "photo.png",
				mediaType: "image/png",
				data: "aGVsbG8=",
			},
			{
				type: "file",
				filename: "brief.pdf",
				mediaType: "application/pdf",
				data: "aGVsbG8=",
			},
		]);
	});

	it("decodes markdown for the inline text block", () => {
		const markdown = "Hello library";
		const block = formatInlineTextAttachments([
			{
				filename: "notes.md",
				mediaType: "text/markdown",
				dataBase64: Buffer.from(markdown, "utf8").toString("base64"),
				byteSize: Buffer.from(markdown, "utf8").byteLength,
			},
		]);
		expect(block).toContain("Attached file: notes.md (text/markdown)");
		expect(block).toContain(markdown);
		expect(block).not.toContain("deck.pptx");
	});
});

describe("sanitizeModelMessagesForProvider", () => {
	it("converts markdown file parts to text and drops powerpoint", () => {
		const markdown = "# Plan";
		const sanitized = sanitizeModelMessagesForProvider([
			{
				role: "user",
				content: [
					{ type: "text", text: "Add these files" },
					{
						type: "file",
						filename: "notes.md",
						mediaType: "text/markdown",
						data: Buffer.from(markdown, "utf8").toString("base64"),
					},
					{
						type: "file",
						filename: "deck.pptx",
						mediaType:
							"application/vnd.openxmlformats-officedocument.presentationml.presentation",
						data: "aGVsbG8=",
					},
					{
						type: "file",
						filename: "shot.png",
						mediaType: "image/png",
						data: "aGVsbG8=",
					},
				],
			},
		]);
		const content = sanitized[0]?.content;
		expect(Array.isArray(content)).toBe(true);
		const parts = content as Array<{
			type: string;
			text?: string;
			mediaType?: string;
			filename?: string;
		}>;
		expect(
			parts.some(
				(part) => part.type === "file" && part.mediaType === "text/markdown",
			),
		).toBe(false);
		expect(
			parts.some(
				(part) =>
					part.type === "file" && part.mediaType?.includes("presentationml"),
			),
		).toBe(false);
		expect(
			parts.some(
				(part) => part.type === "text" && part.text?.includes("# Plan"),
			),
		).toBe(true);
		expect(
			parts.some(
				(part) => part.type === "file" && part.filename === "shot.png",
			),
		).toBe(true);
	});
});
