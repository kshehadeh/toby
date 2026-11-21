import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type FlowCatalogTool,
	type FlowDocument,
	UserFlowValidationError,
	deleteUserFlowDocument,
	extractFlowResult,
	inferResultPointer,
	saveFlowDocument,
	saveUserFlowDocument,
	validateUserFlowDocument,
} from "@toby/core/flows";
import { closeChatDbForTests } from "@toby/core/session-store";

/** Tool → LLM summary flow, saved as a built-in row in protection tests. */
const summaryFlowFixture: FlowDocument = {
	id: "flow.test.builtin-summary",
	name: "flow.test.builtin-summary",
	nodes: [
		{
			id: "fetch-unread",
			type: "tool_executor",
			tool: { standardTool: "email.unreadSummary" },
			outputs: { unread: "result" },
		},
		{
			id: "summarize",
			type: "llm_prompter",
			schema: { kind: "markdown" },
			inputs: { data: { from: "unread" } },
			outputs: { summary: "object" },
			systemPrompt: "Summarize unread mail.",
		},
	],
};

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-user-flows-"));
}

const macosWifi: FlowCatalogTool = {
	moduleName: "macos",
	toolName: "macWifiSetPower",
	displayName: "Set Wi-Fi power",
	inputSchema: {
		type: "object",
		properties: { enabled: { type: "boolean" } },
		required: ["enabled"],
	},
};

const macosMinimize: FlowCatalogTool = {
	moduleName: "macos",
	toolName: "macWindowsMinimizeAll",
	displayName: "Minimize all windows",
	inputSchema: { type: "object", properties: {} },
};

const archiveEmail: FlowCatalogTool = {
	moduleName: "email",
	toolName: "archiveEmail",
	displayName: "Archive email",
	inputSchema: {
		type: "object",
		properties: {
			uids: { type: "array" },
			mailbox: { type: "string" },
		},
		required: ["uids"],
	},
};

const catalog = [macosWifi, macosMinimize, archiveEmail];
const connected = ["macos"];

function wifiThenMinimize(overrides?: Partial<FlowDocument>): FlowDocument {
	return {
		id: "flow.test.wifi-minimize",
		name: "Focus mode",
		description: "Turn off Wi-Fi and minimize windows",
		nodes: [
			{
				id: "wifi-off",
				type: "tool_executor",
				tool: { moduleName: "macos", toolName: "macWifiSetPower" },
				inputs: { enabled: { const: false } },
			},
			{
				id: "minimize",
				type: "tool_executor",
				tool: { moduleName: "macos", toolName: "macWindowsMinimizeAll" },
			},
		],
		...overrides,
	};
}

describe("validateUserFlowDocument", () => {
	it("accepts a const-only wifi then minimize macro and defaults modal", () => {
		const normalized = validateUserFlowDocument(wifiThenMinimize(), {
			tools: catalog,
			connectedModules: connected,
		});
		expect(normalized.destinations).toEqual([{ type: "modal" }]);
		expect(normalized.name).toBe("Focus mode");
	});

	it("accepts curated flow icons and rejects unsupported symbols", () => {
		const normalized = validateUserFlowDocument(
			wifiThenMinimize({ icon: "flame" }),
			{
				tools: catalog,
				connectedModules: connected,
			},
		);
		expect(normalized.icon).toBe("flame");

		expect(() =>
			validateUserFlowDocument(wifiThenMinimize({ icon: "not.a.symbol" }), {
				tools: catalog,
				connectedModules: connected,
			}),
		).toThrow(/not a supported flow icon/);
	});

	it("accepts curated flow colors and rejects unsupported values", () => {
		const normalized = validateUserFlowDocument(
			wifiThenMinimize({ color: "blue" }),
			{
				tools: catalog,
				connectedModules: connected,
			},
		);
		expect(normalized.color).toBe("blue");

		expect(() =>
			validateUserFlowDocument(wifiThenMinimize({ color: "hotpink" }), {
				tools: catalog,
				connectedModules: connected,
			}),
		).toThrow(/not a supported flow color/);
	});

	it("preserves dashboard colors independently of the flow tile color", () => {
		for (const variant of ["runner"] as const) {
			for (const color of ["blue", "neutral"]) {
				const normalized = validateUserFlowDocument(
					wifiThenMinimize({
						color: "teal",
						destinations: [{ type: "dashboard", variant, color }],
					}),
					{ tools: catalog, connectedModules: connected },
				);
				expect(normalized.color).toBe("teal");
				expect(normalized.destinations).toEqual([
					{ type: "dashboard", variant, color },
				]);
			}
		}
	});

	it("rejects unknown and non-string dashboard colors", () => {
		for (const color of ["hotpink", "", 42, null]) {
			expect(() =>
				validateUserFlowDocument(
					wifiThenMinimize({
						destinations: [
							{ type: "dashboard", variant: "runner", color } as never,
						],
					}),
					{ tools: catalog, connectedModules: connected },
				),
			).toThrow(/Dashboard color/);
		}
	});

	it("rejects bag wiring on a tool input", () => {
		const doc = wifiThenMinimize({
			nodes: [
				{
					id: "archive",
					type: "tool_executor",
					tool: { moduleName: "email", toolName: "archiveEmail" },
					inputs: { uids: { from: "unread", path: "items" } },
				},
			],
		});
		expect(() =>
			validateUserFlowDocument(doc, {
				tools: catalog,
				connectedModules: ["macos", "email"],
			}),
		).toThrow(UserFlowValidationError);
		try {
			validateUserFlowDocument(doc, {
				tools: catalog,
				connectedModules: ["macos", "email"],
			});
		} catch (error) {
			expect(error).toBeInstanceOf(UserFlowValidationError);
			expect((error as UserFlowValidationError).issues.join(" ")).toMatch(
				/previous step output/,
			);
		}
	});

	it("requires the declared result to reference an emitted bag key, not a node id", () => {
		const doc = wifiThenMinimize({
			nodes: [
				{
					id: "recommendation",
					type: "llm_prompter",
					schema: { kind: "markdown" },
					systemPrompt: "Recommend next work",
					userPrompt: "Use the supplied data",
					outputs: { summary: "object" },
				},
			],
			result: { from: "recommendation", path: "markdown" },
		});
		expect(() =>
			validateUserFlowDocument(doc, {
				tools: catalog,
				connectedModules: connected,
			}),
		).toThrow(/unknown output "recommendation"/);
		const valid = validateUserFlowDocument(
			{ ...doc, result: { from: "summary", path: "markdown" } },
			{ tools: catalog, connectedModules: connected },
		);
		expect(
			extractFlowResult({ summary: { markdown: "Start here" } }, valid).text,
		).toBe("Start here");
		const defaults = validateUserFlowDocument(
			{
				...doc,
				nodes: [{ ...doc.nodes[0], outputs: undefined }],
				result: { from: "object", path: "markdown" },
			},
			{ tools: catalog, connectedModules: connected },
		);
		expect(
			extractFlowResult({ object: { markdown: "Default output" } }, defaults)
				.text,
		).toBe("Default output");
	});

	it("rejects a required tool input that was not filled", () => {
		const doc = wifiThenMinimize({
			nodes: [
				{
					id: "wifi-off",
					type: "tool_executor",
					tool: { moduleName: "macos", toolName: "macWifiSetPower" },
				},
			],
		});
		expect(() =>
			validateUserFlowDocument(doc, {
				tools: catalog,
				connectedModules: connected,
			}),
		).toThrow(/missing required input "enabled"/i);
	});

	it("accepts an action after an LLM node", () => {
		const doc: FlowDocument = {
			id: "flow.test.llm-middle",
			name: "Bad order",
			nodes: [
				{
					id: "draft",
					type: "llm_prompter",
					schema: { kind: "markdown" },
					systemPrompt: "Pick emails",
					userPrompt: "Which?",
				},
				{
					id: "minimize",
					type: "tool_executor",
					tool: { moduleName: "macos", toolName: "macWindowsMinimizeAll" },
				},
			],
		};
		expect(() =>
			validateUserFlowDocument(doc, {
				tools: catalog,
				connectedModules: connected,
			}),
		).not.toThrow();
	});

	it("accepts earlier output wiring and rejects forward and unsafe references", () => {
		const doc = wifiThenMinimize();
		doc.nodes[0].outputs = { previous: "result" };
		doc.nodes[1] = {
			id: "archive",
			type: "tool_executor",
			tool: { moduleName: "email", toolName: "archiveEmail" },
			inputs: { uids: { from: "previous", path: "items" } },
		};
		const options = { tools: catalog, connectedModules: ["macos", "email"] };
		expect(() => validateUserFlowDocument(doc, options)).not.toThrow();
		for (const source of [
			{ from: "later" },
			{ from: "previous", path: "constructor.prototype" },
		]) {
			doc.nodes[1].inputs = { uids: source };
			expect(() => validateUserFlowDocument(doc, options)).toThrow(
				/previous step output/,
			);
		}
	});

	it("accepts several AI steps that read earlier AI answers", () => {
		const node = {
			id: "think",
			type: "llm_prompter" as const,
			schema: { kind: "markdown" as const },
			systemPrompt: "Summarize",
			userPrompt: "Hello",
			outputs: { draft: "object" },
		};
		const normalized = validateUserFlowDocument(
			wifiThenMinimize({
				nodes: [
					node,
					{
						...node,
						id: "again",
						userPrompt: "Polish {{json bag.draft}}",
						outputs: { polished: "object" },
					},
				],
				result: { from: "polished", path: "markdown" },
			}),
			{ tools: catalog, connectedModules: connected },
		);
		expect(normalized.nodes.map((n) => n.id)).toEqual(["think", "again"]);
	});

	it("accepts a last LLM node", () => {
		const doc: FlowDocument = {
			id: "flow.test.summarize",
			name: "Summarize",
			nodes: [
				{
					id: "minimize",
					type: "tool_executor",
					tool: { moduleName: "macos", toolName: "macWindowsMinimizeAll" },
				},
				{
					id: "note",
					type: "llm_prompter",
					schema: { kind: "markdown" },
					systemPrompt: "Write a one-line status.",
					userPrompt: "Done.",
				},
			],
		};
		const normalized = validateUserFlowDocument(doc, {
			tools: catalog,
			connectedModules: connected,
		});
		expect(normalized.nodes[1]?.type).toBe("llm_prompter");
	});

	it("rejects an email destination when email is not connected", () => {
		const doc = wifiThenMinimize({
			destinations: [
				{
					type: "email",
					to: ["me@example.com"],
					subject: "Focus",
				},
			],
		});
		expect(() =>
			validateUserFlowDocument(doc, {
				tools: catalog,
				connectedModules: connected,
			}),
		).toThrow(/Email is not connected/);
	});

	it("accepts email and slack destinations when those modules are connected", () => {
		const doc = wifiThenMinimize({
			destinations: [
				{ type: "modal" },
				{
					type: "email",
					to: ["me@example.com"],
					subject: "Focus",
				},
				{ type: "slack", channel: "#ops" },
			],
		});
		const normalized = validateUserFlowDocument(doc, {
			tools: catalog,
			connectedModules: ["macos", "email", "slack"],
		});
		expect(normalized.destinations).toHaveLength(3);
	});

	it("accepts a dashboard destination and rejects two of them", () => {
		const one = validateUserFlowDocument(
			wifiThenMinimize({
				destinations: [{ type: "dashboard", variant: "runner" }],
			}),
			{ tools: catalog, connectedModules: connected },
		);
		expect(one.destinations).toEqual([
			{ type: "dashboard", variant: "runner" },
		]);

		expect(() =>
			validateUserFlowDocument(
				wifiThenMinimize({
					destinations: [
						{ type: "dashboard", variant: "runner" },
						{ type: "dashboard", variant: "runner", color: "teal" },
					],
				}),
				{ tools: catalog, connectedModules: connected },
			),
		).toThrow(/only one Dashboard destination/);
	});

	it("rejects retired informational Home cards and strips refresh on runner", () => {
		for (const refresh of [undefined, "asNeeded", "manual"]) {
			expect(() =>
				validateUserFlowDocument(
					wifiThenMinimize({
						destinations: [
							{ type: "dashboard", variant: "informational", refresh } as never,
						],
					}),
					{ tools: catalog, connectedModules: connected },
				),
			).toThrow(/Home cards were removed/);
		}

		const runner = validateUserFlowDocument(
			wifiThenMinimize({
				destinations: [
					{
						type: "dashboard",
						variant: "runner",
						refresh: "asNeeded",
					} as never,
				],
			}),
			{ tools: catalog, connectedModules: connected },
		);
		expect(runner.destinations).toEqual([
			{ type: "dashboard", variant: "runner" },
		]);
	});

	it("rejects a dashboard destination without a variant", () => {
		expect(() =>
			validateUserFlowDocument(
				wifiThenMinimize({
					destinations: [{ type: "dashboard" } as never],
				}),
				{ tools: catalog, connectedModules: connected },
			),
		).toThrow(/variant/);
	});

	it("rejects an unknown destination type", () => {
		const doc = wifiThenMinimize({
			destinations: [{ type: "carrier-pigeon" } as never],
		});
		expect(() =>
			validateUserFlowDocument(doc, {
				tools: catalog,
				connectedModules: connected,
			}),
		).toThrow(/Unknown destination type/);
	});
});

describe("extractFlowResult", () => {
	it("infers markdown from a last LLM node that writes summary", () => {
		const pointer = inferResultPointer(summaryFlowFixture);
		expect(pointer).toEqual({ from: "summary", path: "markdown" });

		const extracted = extractFlowResult(
			{ summary: { markdown: "## Inbox\n- **Standup**" } },
			summaryFlowFixture,
		);
		expect(extracted.format).toBe("markdown");
		expect(extracted.text).toBe("## Inbox\n- **Standup**");
	});

	it("uses last-node appliedActions when the tool payload is structured", () => {
		const doc = wifiThenMinimize();
		const extracted = extractFlowResult(
			{ result: { ok: true, minimizedWindowCount: 12 } },
			doc,
			{
				lastNodeResult: {
					result: { ok: true, minimizedWindowCount: 12 },
					appliedActions: ["Minimized 12 window(s)."],
				},
			},
		);
		expect(extracted.format).toBe("plain");
		expect(extracted.text).toBe("Minimized 12 window(s).");
	});

	it("honors an explicit result pointer", () => {
		const doc = wifiThenMinimize({
			result: { from: "note", path: "markdown" },
		});
		const extracted = extractFlowResult(
			{ note: { markdown: "All quiet." }, result: { ok: true } },
			doc,
		);
		expect(extracted.text).toBe("All quiet.");
		expect(extracted.format).toBe("markdown");
	});
});

describe("saveUserFlowDocument / deleteUserFlowDocument", () => {
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = makeTempDir();
	});

	afterEach(() => {
		closeChatDbForTests();
		const dir = process.env.TOBY_DIR;
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		if (dir && fs.existsSync(dir)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("round-trips a user flow and refuses to overwrite a built-in", () => {
		const saved = saveUserFlowDocument(wifiThenMinimize());
		expect(saved.builtin).toBe(false);
		expect(saved.document.nodes).toHaveLength(2);

		saveFlowDocument(summaryFlowFixture, { builtin: true });
		expect(() =>
			saveUserFlowDocument({
				...summaryFlowFixture,
				description: "hacked",
			}),
		).toThrow(/Cannot overwrite built-in/);
	});

	it("refuses to delete a built-in and deletes a custom flow", () => {
		saveFlowDocument(summaryFlowFixture, { builtin: true });
		expect(() => deleteUserFlowDocument("flow.test.builtin-summary")).toThrow(
			/Cannot delete built-in/,
		);

		saveUserFlowDocument(wifiThenMinimize());
		expect(deleteUserFlowDocument("flow.test.wifi-minimize")).toBe(true);
		expect(deleteUserFlowDocument("flow.test.wifi-minimize")).toBe(false);
	});
});
