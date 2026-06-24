import { isAbortError } from "../abort";
import type { Persona } from "../config/index";
import { log } from "../logging/chat-log";
import {
	type RoutingEntityType,
	type StoredRoutingEmbedding,
	deleteRoutingEmbeddingsNotMatching,
	loadRoutingEmbeddings,
	upsertRoutingEmbedding,
} from "../session-store";
import { parseCatalogLines } from "./catalog-parse";
import {
	createEmbeddingModelForPersona,
	embedTexts,
	resolveRoutingEmbedModelId,
} from "./embeddings";
import { searchTopKByCosine } from "./search";

export {
	cosineSimilarity,
	searchTopKByCosine,
	vectorToBuffer,
	bufferToVector,
} from "./search";
export {
	createEmbeddingModelForPersona,
	resolveRoutingEmbedModelId,
} from "./embeddings";
export { parseCatalogLines } from "./catalog-parse";
import { isSemanticRoutingEnabled } from "./config";

export { isSemanticRoutingEnabled } from "./config";

const SKILL_TOP_K = 2;

export type RoutingIndexEntry = {
	readonly entityType: RoutingEntityType;
	readonly id: string;
	readonly text: string;
	readonly vector: readonly number[];
};

export type RoutingIndex = {
	readonly catalogSignature: string;
	readonly model: string;
	readonly tools: readonly RoutingIndexEntry[];
	readonly skills: readonly RoutingIndexEntry[];
};

let activeIndex: RoutingIndex | null = null;

export function getActiveRoutingIndex(): RoutingIndex | null {
	return activeIndex;
}

export function clearActiveRoutingIndexForTests(): void {
	activeIndex = null;
}

export function buildRoutingCatalogSignature(params: {
	readonly toolsCatalogSignature: string;
	readonly skillsCatalogSignature: string;
	readonly embedModelId: string;
}): string {
	return `${params.toolsCatalogSignature}:${params.skillsCatalogSignature}:${params.embedModelId}`;
}

function routingExcludedToolNames(): ReadonlySet<string> {
	return new Set([
		"askUser",
		"getCurrentDateTime",
		"loadLocalSkillInstructions",
		"tobyListIntegrations",
		"tobyListTools",
		"tobyListSkills",
		"createLocalSkill",
	]);
}

export function getRoutingTopK(): number {
	const raw = process.env.TOBY_ROUTING_TOP_K?.trim();
	if (!raw) {
		return 8;
	}
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : 8;
}

export function getRoutingMinScore(): number {
	const raw = process.env.TOBY_ROUTING_MIN_SCORE?.trim();
	if (!raw) {
		return 0.2;
	}
	const n = Number.parseFloat(raw);
	return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.2;
}

/**
 * Minimum cosine similarity for **skill** routing. Skills should only activate
 * on a strong semantic match — a loose match (e.g. "plan my day" vs. "weekly
 * work summary") should not pull in a skill. Default is higher than the tool
 * min score (`0.35` vs `0.2`) to avoid false-positive skill activation.
 */
export function getRoutingSkillMinScore(): number {
	const raw = process.env.TOBY_ROUTING_SKILL_MIN_SCORE?.trim();
	if (!raw) {
		return 0.35;
	}
	const n = Number.parseFloat(raw);
	return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.35;
}

export type WarmRoutingIndexParams = {
	readonly persona: Persona;
	readonly toolsCatalogText: string;
	readonly skillsCatalogText: string;
	readonly toolsCatalogSignature: string;
	readonly skillsCatalogSignature: string;
	readonly abortSignal?: AbortSignal;
};

export type WarmRoutingIndexResult = {
	readonly index: RoutingIndex | null;
	readonly rebuilt: boolean;
};

/**
 * Load or build static embeddings for tools and skills. Returns null when
 * semantic routing is disabled or embedding credentials are unavailable.
 */
export async function warmRoutingIndex(
	params: WarmRoutingIndexParams,
): Promise<WarmRoutingIndexResult> {
	if (!isSemanticRoutingEnabled()) {
		activeIndex = null;
		return { index: null, rebuilt: false };
	}

	const embedModelId = resolveRoutingEmbedModelId(params.persona);
	const catalogSignature = buildRoutingCatalogSignature({
		toolsCatalogSignature: params.toolsCatalogSignature,
		skillsCatalogSignature: params.skillsCatalogSignature,
		embedModelId,
	});

	if (
		activeIndex?.catalogSignature === catalogSignature &&
		activeIndex.model === embedModelId
	) {
		return { index: activeIndex, rebuilt: false };
	}

	const model = createEmbeddingModelForPersona(params.persona);
	if (!model) {
		activeIndex = null;
		return { index: null, rebuilt: false };
	}

	const excluded = routingExcludedToolNames();
	const toolLines = parseCatalogLines(params.toolsCatalogText).filter(
		(e) => !excluded.has(e.id),
	);
	const skillLines = parseCatalogLines(params.skillsCatalogText);

	const expectedCount = toolLines.length + skillLines.length;
	const stored = loadRoutingEmbeddings({
		catalogSignature,
		model: embedModelId,
	});

	const storedByKey = new Map<string, StoredRoutingEmbedding>();
	for (const row of stored) {
		storedByKey.set(`${row.entityType}:${row.entityId}`, row);
	}

	const missingTools = toolLines.filter(
		(t) => !storedByKey.has(`tool:${t.id}`),
	);
	const missingSkills = skillLines.filter(
		(s) => !storedByKey.has(`skill:${s.id}`),
	);
	const needsRebuild =
		expectedCount > 0 &&
		(stored.length !== expectedCount ||
			missingTools.length > 0 ||
			missingSkills.length > 0);

	let rebuilt = false;

	if (needsRebuild && expectedCount > 0) {
		const texts: string[] = [];
		const meta: Array<{ type: RoutingEntityType; id: string }> = [];
		for (const t of toolLines) {
			texts.push(t.text);
			meta.push({ type: "tool", id: t.id });
		}
		for (const s of skillLines) {
			texts.push(s.text);
			meta.push({ type: "skill", id: s.id });
		}

		try {
			const vectors = await embedTexts({
				model,
				values: texts,
				abortSignal: params.abortSignal,
			});
			for (let i = 0; i < meta.length; i++) {
				const m = meta[i];
				const vec = vectors[i];
				if (!m || !vec) {
					continue;
				}
				upsertRoutingEmbedding({
					entityType: m.type,
					entityId: m.id,
					catalogSignature,
					model: embedModelId,
					vector: vec,
				});
			}
			deleteRoutingEmbeddingsNotMatching({
				catalogSignature,
				model: embedModelId,
			});
			rebuilt = true;
			log("info", "prep", "routing_index_rebuilt", {
				toolCount: toolLines.length,
				skillCount: skillLines.length,
				model: embedModelId,
			});
		} catch (err) {
			if (isAbortError(err)) {
				throw err;
			}
			log("warn", "prep", "routing_index_build_failed", {
				error: err instanceof Error ? err.message : String(err),
			});
			activeIndex = null;
			return { index: null, rebuilt: false };
		}
	}

	const freshStored = loadRoutingEmbeddings({
		catalogSignature,
		model: embedModelId,
	});
	const tools: RoutingIndexEntry[] = [];
	const skills: RoutingIndexEntry[] = [];

	for (const t of toolLines) {
		const row = freshStored.find(
			(r) => r.entityType === "tool" && r.entityId === t.id,
		);
		if (row) {
			tools.push({
				entityType: "tool",
				id: t.id,
				text: t.text,
				vector: row.vector,
			});
		}
	}
	for (const s of skillLines) {
		const row = freshStored.find(
			(r) => r.entityType === "skill" && r.entityId === s.id,
		);
		if (row) {
			skills.push({
				entityType: "skill",
				id: s.id,
				text: s.text,
				vector: row.vector,
			});
		}
	}

	const index: RoutingIndex = {
		catalogSignature,
		model: embedModelId,
		tools,
		skills,
	};
	activeIndex = index;
	return { index, rebuilt };
}

export type RouteToolsAndSkillsParams = {
	readonly persona: Persona;
	readonly userText: string;
	readonly toolIntegrationLabels: Readonly<Record<string, string>>;
	readonly allowedToolNamesLower: ReadonlySet<string>;
	readonly allowedSkillNamesLower: ReadonlySet<string>;
	readonly index: RoutingIndex | null;
	readonly abortSignal?: AbortSignal;
};

export type RouteToolsAndSkillsResult = {
	readonly relevantTools: string[];
	readonly relevantSkills: string[];
	readonly relevantIntegrations: string[];
};

function canonicalToolName(
	name: string,
	allowedLower: ReadonlySet<string>,
	labels: Readonly<Record<string, string>>,
): string | null {
	const lower = name.trim().toLowerCase();
	if (!allowedLower.has(lower)) {
		return null;
	}
	for (const [toolName] of Object.entries(labels)) {
		if (toolName.trim().toLowerCase() === lower) {
			return toolName;
		}
	}
	return name.trim();
}

function integrationsFromTools(
	toolNames: readonly string[],
	labels: Readonly<Record<string, string>>,
): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const name of toolNames) {
		const label = labels[name]?.trim();
		if (!label) {
			continue;
		}
		const key = label.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(label);
	}
	return out;
}

/**
 * Embed the user query and return top-K tools and skills from a warmed index.
 */
export async function routeToolsAndSkills(
	params: RouteToolsAndSkillsParams,
): Promise<RouteToolsAndSkillsResult> {
	const empty: RouteToolsAndSkillsResult = {
		relevantTools: [],
		relevantSkills: [],
		relevantIntegrations: [],
	};

	if (!params.index) {
		return empty;
	}

	const model = createEmbeddingModelForPersona(params.persona);
	if (!model) {
		return empty;
	}

	const text = params.userText.trim();
	if (!text) {
		return empty;
	}

	let queryVector: number[];
	try {
		const [vec] = await embedTexts({
			model,
			values: [text],
			abortSignal: params.abortSignal,
		});
		if (!vec) {
			return empty;
		}
		queryVector = vec;
	} catch (err) {
		if (isAbortError(err)) {
			throw err;
		}
		log("warn", "prep", "routing_query_embed_failed", {
			error: err instanceof Error ? err.message : String(err),
		});
		return empty;
	}

	const topK = getRoutingTopK();
	const toolMinScore = getRoutingMinScore();
	const skillMinScore = getRoutingSkillMinScore();

	const toolIds = searchTopKByCosine({
		query: queryVector,
		candidates: params.index.tools.map((t) => ({
			id: t.id,
			vector: t.vector,
		})),
		topK,
		minScore: toolMinScore,
	});

	const skillIds = searchTopKByCosine({
		query: queryVector,
		candidates: params.index.skills.map((s) => ({
			id: s.id,
			vector: s.vector,
		})),
		topK: SKILL_TOP_K,
		minScore: skillMinScore,
	});

	const relevantTools: string[] = [];
	const seenTools = new Set<string>();
	for (const id of toolIds) {
		const canonical = canonicalToolName(
			id,
			params.allowedToolNamesLower,
			params.toolIntegrationLabels,
		);
		if (!canonical) {
			continue;
		}
		const lower = canonical.toLowerCase();
		if (seenTools.has(lower)) {
			continue;
		}
		seenTools.add(lower);
		relevantTools.push(canonical);
	}

	const relevantSkills: string[] = [];
	const seenSkills = new Set<string>();
	for (const id of skillIds) {
		const lower = id.trim().toLowerCase();
		if (!params.allowedSkillNamesLower.has(lower) || seenSkills.has(lower)) {
			continue;
		}
		seenSkills.add(lower);
		relevantSkills.push(id);
	}

	return {
		relevantTools,
		relevantSkills,
		relevantIntegrations: integrationsFromTools(
			relevantTools,
			params.toolIntegrationLabels,
		),
	};
}
