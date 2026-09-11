import { type Tool, tool } from "ai";
import { z } from "zod";

export const ENABLE_TOOLS_TOOL_NAME = "enableTools";

const MAX_ENABLE_TOOLS = 15;

const enableToolsInputSchema = z.object({
	names: z
		.array(z.string().min(1))
		.min(1)
		.max(MAX_ENABLE_TOOLS)
		.describe(
			"Exact tool names from tobyListTools to add to this conversation (max 15)",
		),
});

/** Deduplicate tool names, preserving first-seen canonical spelling. */
export function unionToolNames(
	base: readonly string[],
	extra: readonly string[],
): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const name of [...base, ...extra]) {
		const trimmed = name.trim();
		if (!trimmed) {
			continue;
		}
		const lower = trimmed.toLowerCase();
		if (seen.has(lower)) {
			continue;
		}
		seen.add(lower);
		out.push(trimmed);
	}
	return out;
}

function parseEnableToolsNames(input: unknown): string[] {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return [];
	}
	const names = (input as { names?: unknown }).names;
	if (!Array.isArray(names)) {
		return [];
	}
	return names.filter(
		(name): name is string =>
			typeof name === "string" && name.trim().length > 0,
	);
}

export type EnableToolsPartition = {
	readonly enabled: string[];
	readonly unknown: string[];
	readonly blocked: string[];
};

/**
 * Partition requested names into catalog hits, unknown names, and tools that
 * cannot be enabled this way (explicit-request-only unless already active).
 */
export function partitionEnableToolsNames(
	requested: readonly string[],
	allowedLower: ReadonlySet<string>,
	blockedLower: ReadonlySet<string>,
	canonicalByLower: ReadonlyMap<string, string>,
): EnableToolsPartition {
	const enabled: string[] = [];
	const unknown: string[] = [];
	const blocked: string[] = [];
	const seen = new Set<string>();
	for (const raw of requested) {
		const lower = raw.trim().toLowerCase();
		if (!lower || seen.has(lower)) {
			continue;
		}
		seen.add(lower);
		if (!allowedLower.has(lower)) {
			unknown.push(raw.trim());
			continue;
		}
		if (blockedLower.has(lower)) {
			blocked.push(canonicalByLower.get(lower) ?? raw.trim());
			continue;
		}
		enabled.push(canonicalByLower.get(lower) ?? raw.trim());
	}
	return { enabled, unknown, blocked };
}

function canonicalMapFromNames(names: readonly string[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const name of names) {
		const trimmed = name.trim();
		if (!trimmed) {
			continue;
		}
		map.set(trimmed.toLowerCase(), trimmed);
	}
	return map;
}

export function lookupFromToolNames(names: readonly string[]): {
	readonly allowedLower: ReadonlySet<string>;
	readonly canonicalByLower: ReadonlyMap<string, string>;
} {
	const canonicalByLower = canonicalMapFromNames(names);
	return {
		allowedLower: new Set(canonicalByLower.keys()),
		canonicalByLower,
	};
}

/** Collect tool names the model asked to enable from AI SDK step tool calls. */
export function collectEnabledToolNamesFromSteps(
	steps: ReadonlyArray<{
		readonly toolCalls?: ReadonlyArray<{
			readonly toolName: string;
			readonly input?: unknown;
		}>;
	}>,
	allowedLower: ReadonlySet<string>,
	blockedLower: ReadonlySet<string>,
	canonicalByLower: ReadonlyMap<string, string>,
): string[] {
	const requested: string[] = [];
	for (const step of steps) {
		for (const call of step.toolCalls ?? []) {
			if (call.toolName !== ENABLE_TOOLS_TOOL_NAME) {
				continue;
			}
			requested.push(...parseEnableToolsNames(call.input));
		}
	}
	return partitionEnableToolsNames(
		requested,
		allowedLower,
		blockedLower,
		canonicalByLower,
	).enabled;
}

/** Collect enabled names from chatWithTools-normalized tool call records. */
export function collectEnabledToolNamesFromCalls(
	calls: ReadonlyArray<{
		readonly name: string;
		readonly args: Record<string, unknown>;
	}>,
	allowedLower: ReadonlySet<string>,
	blockedLower: ReadonlySet<string>,
	canonicalByLower: ReadonlyMap<string, string>,
): string[] {
	const requested: string[] = [];
	for (const call of calls) {
		if (call.name !== ENABLE_TOOLS_TOOL_NAME) {
			continue;
		}
		requested.push(...parseEnableToolsNames(call.args));
	}
	return partitionEnableToolsNames(
		requested,
		allowedLower,
		blockedLower,
		canonicalByLower,
	).enabled;
}

export function createEnableToolsTool(params: {
	readonly allowedToolNames: readonly string[];
	readonly blockedToolNames: readonly string[];
}): Tool {
	const canonicalByLower = canonicalMapFromNames(params.allowedToolNames);
	const allowedLower = new Set(canonicalByLower.keys());
	const blockedLower = new Set(
		params.blockedToolNames.map((name) => name.trim().toLowerCase()),
	);

	return tool({
		description:
			"Add tools from the full catalog to this conversation so you can call them on the next step. Use after tobyListTools when you need tools that are not in your current set. Prefer this over delegateToSubAgent when you will keep using those tools. Do not enable tools you will not use. createLocalSkill cannot be enabled this way unless it is already in the current set.",
		inputSchema: enableToolsInputSchema,
		execute: async ({ names }) => {
			const { enabled, unknown, blocked } = partitionEnableToolsNames(
				names,
				allowedLower,
				blockedLower,
				canonicalByLower,
			);
			return {
				ok: enabled.length > 0,
				enabled,
				unknown,
				blocked,
				hint:
					enabled.length > 0
						? "These tools will be available on the next step of this turn and remain in the session toolset."
						: "No tools were enabled. Use exact names from tobyListTools. createLocalSkill requires an explicit user request to author a skill.",
			};
		},
	});
}

export function enableToolsPromptSection(): string {
	return `
## Adding tools during a turn

Only tools in your **current tool set** can be called. Core discovery tools are always present; pretreatment adds a small relevant subset; later turns keep previously used tools and may add more.

When you need a tool that is not currently available:
1. Call **tobyListTools** to see the full catalog (not just the current set).
2. Call **enableTools** with the exact names you need. They become callable on the next step and stay in this session.
3. Use **delegateToSubAgent** instead for a one-shot task with tools you do not need to keep (the sub-agent does not share this conversation).

Do not enable the entire catalog. Pick only the tools required for the user's request.
`;
}
