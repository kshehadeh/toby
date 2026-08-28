import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type FlowCatalogTool,
	type FlowDocument,
	UserFlowValidationError,
	deleteUserFlowDocument,
	emailDashboardSummaryDocument,
	extractFlowResult,
	inferResultPointer,
	saveFlowDocument,
	saveUserFlowDocument,
	validateUserFlowDocument,
} from "@toby/core/flows";
import { closeChatDbForTests } from "@toby/core/session-store";

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
				/author-time constant/,
			);
		}
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

	it("rejects an LLM node that is not last", () => {
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
		).toThrow(/must be the last step/);
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

	it("rejects reserved built-in ids", () => {
		expect(() =>
			validateUserFlowDocument(
				{ ...emailDashboardSummaryDocument, id: "dashboard.email.summary" },
				{ tools: catalog, connectedModules: connected },
			),
		).toThrow(/reserved for built-in/);
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
						{ type: "dashboard", variant: "informational" },
					],
				}),
				{ tools: catalog, connectedModules: connected },
			),
		).toThrow(/only one Dashboard destination/);
	});

	it("accepts informational dashboard refresh and strips it on runner", () => {
		const asNeeded = validateUserFlowDocument(
			wifiThenMinimize({
				destinations: [
					{
						type: "dashboard",
						variant: "informational",
						refresh: "asNeeded",
					},
				],
			}),
			{ tools: catalog, connectedModules: connected },
		);
		expect(asNeeded.destinations).toEqual([
			{
				type: "dashboard",
				variant: "informational",
				refresh: "asNeeded",
			},
		]);

		const manual = validateUserFlowDocument(
			wifiThenMinimize({
				destinations: [
					{
						type: "dashboard",
						variant: "informational",
						refresh: "manual",
					},
				],
			}),
			{ tools: catalog, connectedModules: connected },
		);
		expect(manual.destinations).toEqual([
			{ type: "dashboard", variant: "informational", refresh: "manual" },
		]);

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

	it("rejects an unknown dashboard refresh value", () => {
		expect(() =>
			validateUserFlowDocument(
				wifiThenMinimize({
					destinations: [
						{
							type: "dashboard",
							variant: "informational",
							refresh: "hourly",
						} as never,
					],
				}),
				{ tools: catalog, connectedModules: connected },
			),
		).toThrow(/asNeeded" or "manual/);
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
		const pointer = inferResultPointer(emailDashboardSummaryDocument);
		expect(pointer).toEqual({ from: "summary", path: "markdown" });

		const extracted = extractFlowResult(
			{ summary: { markdown: "## Inbox\n- **Standup**" } },
			emailDashboardSummaryDocument,
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

		saveFlowDocument(emailDashboardSummaryDocument, { builtin: true });
		expect(() =>
			saveUserFlowDocument({
				...emailDashboardSummaryDocument,
				description: "hacked",
			}),
		).toThrow(/Cannot overwrite built-in/);
	});

	it("refuses to delete a built-in and deletes a custom flow", () => {
		saveFlowDocument(emailDashboardSummaryDocument, { builtin: true });
		expect(() => deleteUserFlowDocument("dashboard.email.summary")).toThrow(
			/Cannot delete built-in/,
		);

		saveUserFlowDocument(wifiThenMinimize());
		expect(deleteUserFlowDocument("flow.test.wifi-minimize")).toBe(true);
		expect(deleteUserFlowDocument("flow.test.wifi-minimize")).toBe(false);
	});
});
