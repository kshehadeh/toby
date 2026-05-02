import type { CoreMessage } from "../../ai/chat";
import {
	type UserIntentSpec,
	isPretreatmentDisabled,
	shouldPretreat,
} from "../../ai/pretreatment";
import type { LocalSkill } from "../../skills/index";
import type { TranscriptEntry } from "./types";

const MAX_SKILL_NAMES_IN_ONE_LINE = 12;
const MAX_DESC_PREVIEW = 72;
const MAX_DESCRIPTION_LINES = 20;

function formatAvailableSkillsLine(skills: readonly LocalSkill[]): string {
	if (skills.length === 0) {
		return "[debug] Local skills available: (none)";
	}
	const names = skills.map((s) => s.name);
	const head = names.slice(0, MAX_SKILL_NAMES_IN_ONE_LINE);
	const extra = names.length - head.length;
	const suffix = extra > 0 ? ` … (+${extra} more)` : "";
	return `[debug] Local skills available (${skills.length}): ${head.join(", ")}${suffix}`;
}

function formatPreflightLine(params: {
	readonly preflightAttempted: boolean;
	readonly spec: UserIntentSpec | null;
}): string {
	if (!params.preflightAttempted) {
		if (isPretreatmentDisabled()) {
			return "[debug] Preflight: not run (TOBY_DISABLE_PRETREATMENT=1)";
		}
		return "[debug] Preflight: not run (heuristic — message did not trigger pretreatment)";
	}
	if (!params.spec) {
		return "[debug] Preflight: ran — no structured spec returned (verbatim user text only)";
	}
	const sel = params.spec.relevantSkills.filter((s) => s.trim());
	if (sel.length === 0) {
		return "[debug] Preflight: ran — skills selected: (none)";
	}
	return `[debug] Preflight: ran — skills selected: ${sel.join(", ")}`;
}

function skillDescriptionLines(skills: readonly LocalSkill[]): string[] {
	const lines: string[] = [];
	const capped = skills.slice(0, MAX_DESCRIPTION_LINES);
	for (const s of capped) {
		const desc =
			s.description.length > MAX_DESC_PREVIEW
				? `${s.description.slice(0, MAX_DESC_PREVIEW - 1)}…`
				: s.description;
		lines.push(`[debug]   · ${s.name}: ${desc}`);
	}
	if (skills.length > MAX_DESCRIPTION_LINES) {
		lines.push(
			`[debug]   … (${skills.length - MAX_DESCRIPTION_LINES} more skills omitted)`,
		);
	}
	return lines;
}

export function getSkillDebugTextLines(params: {
	readonly available: readonly LocalSkill[];
	readonly priorMessages: readonly CoreMessage[] | null;
	readonly rawUserText: string;
	readonly isFirstTurn: boolean;
	readonly spec: UserIntentSpec | null;
}): string[] {
	const raw = params.rawUserText.trim();
	const preflightAttempted =
		raw.length > 0 &&
		shouldPretreat(params.priorMessages, raw, params.isFirstTurn);
	const lines = [formatAvailableSkillsLine(params.available)];
	if (params.available.length > 0) {
		lines.push(...skillDescriptionLines(params.available));
	}
	lines.push(
		formatPreflightLine({
			preflightAttempted,
			spec: preflightAttempted ? params.spec : null,
		}),
	);
	return lines;
}

export function buildSkillDebugTranscriptEntries(params: {
	readonly debug: boolean;
	readonly available: readonly LocalSkill[];
	readonly priorMessages: readonly CoreMessage[] | null;
	readonly rawUserText: string;
	readonly isFirstTurn: boolean;
	readonly spec: UserIntentSpec | null;
}): TranscriptEntry[] {
	if (!params.debug) {
		return [];
	}
	return getSkillDebugTextLines(params).map((text) => ({
		kind: "meta" as const,
		text,
	}));
}
