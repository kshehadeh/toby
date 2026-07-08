import { nativeRequest } from "./native-client";

type JsonRecord = Record<string, unknown>;

export type ToolDefinition = {
	name: string;
	displayName: string;
	description: string;
	readOnly?: boolean;
	inputSchema: {
		type: string;
		properties: Record<string, JsonRecord>;
		required?: string[];
	};
};

function prop(type: string, description: string): JsonRecord {
	return { type, description };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: "searchContacts",
		displayName: "Search contacts",
		description:
			"Search local Apple Contacts by name, organization, email, phone, URL, or address text. Returns contact identifiers and summary fields. Use identifier values for getContact.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: prop(
					"string",
					"Optional search text. Omit or leave empty to list contacts up to limit.",
				),
				limit: prop("number", "Max results (default 25, max 100)"),
			},
		},
	},
	{
		name: "getContact",
		displayName: "Get contact",
		description:
			"Get full details for a single Contacts.app contact by identifier. Use identifiers from searchContacts.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				identifier: prop("string", "Contact identifier from searchContacts"),
			},
			required: ["identifier"],
		},
	},
];

export class ToolFailure extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolFailure";
	}
}

type ExecuteResult = {
	result: JsonRecord;
	appliedActions: string[];
};

function stringValue(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return undefined;
}

function intValue(value: unknown): number | undefined {
	if (typeof value === "number") return Math.trunc(value);
	return undefined;
}

export function executeTool(
	tool: string,
	input: JsonRecord,
	dryRun: boolean,
): ExecuteResult {
	switch (tool) {
		case "searchContacts": {
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would search Apple Contacts with the given filters.",
					},
					appliedActions: [],
				};
			}
			const body: JsonRecord = {};
			const query = stringValue(input.query);
			if (query) body.query = query;
			body.limit = Math.min(Math.max(1, intValue(input.limit) ?? 25), 100);

			const r = nativeRequest("contacts/search", body);
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Search failed.", contacts: [] },
					appliedActions: [],
				};
			}
			const data = r.data ?? {};
			return {
				result: {
					count: data.count ?? 0,
					contacts: data.contacts ?? [],
				},
				appliedActions: [],
			};
		}

		case "getContact": {
			const identifier = stringValue(input.identifier);
			if (!identifier) {
				throw new ToolFailure("identifier is required.");
			}
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: `Would get contact identifier ${identifier}.`,
					},
					appliedActions: [],
				};
			}

			const r = nativeRequest("contacts/get", { identifier });
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Contact not found." },
					appliedActions: [],
				};
			}
			return {
				result: r.data ?? {},
				appliedActions: [],
			};
		}

		default:
			throw new ToolFailure(`Unknown tool: ${tool}`);
	}
}
