import type { FlowDocument } from "./document-types";

/**
 * Built-in flow seed documents keyed by stable id.
 *
 * Empty since Home cards were retired (The Feed replaced the email / tasks /
 * calendar / todos summary flows). Rows for retired ids are pruned on startup
 * by `ensureAllBuiltinFlows`.
 */
export const BUILTIN_FLOWS: Readonly<Record<string, FlowDocument>> = {};

export function isBuiltinFlowId(id: string): boolean {
	return Object.hasOwn(BUILTIN_FLOWS, id.trim());
}

export function getBuiltinFlowDocument(id: string): FlowDocument | undefined {
	return BUILTIN_FLOWS[id.trim()];
}

export function listBuiltinFlowIds(): readonly string[] {
	return Object.keys(BUILTIN_FLOWS).sort((a, b) => a.localeCompare(b));
}
