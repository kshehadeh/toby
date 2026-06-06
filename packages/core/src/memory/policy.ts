import type {
	MemoryCandidate,
	MemoryProposal,
	MemorySensitivity,
	MemoryType,
	MemoryVisibility,
} from "./types";

const RESTRICTED_KEYWORDS = [
	"health",
	"medical",
	"diagnosis",
	"medication",
	"prescription",
	"mental health",
	"depression",
	"anxiety",
	"therapy",
	"psychiatrist",
	"political",
	"political affiliation",
	"republican",
	"democrat",
	"religion",
	"religious",
	"church",
	"mosque",
	"temple",
	"prayer",
	"sexuality",
	"sexual orientation",
	"lgbt",
	"gender identity",
	"location",
	"home address",
	"residence",
	"financial",
	"salary",
	"income",
	"bank account",
	"credit card",
	"debt",
	"ssn",
	"social security",
	"family-sensitive",
	"divorce",
	"custody",
	"abuse",
] as const;

const SENSITIVE_KEYWORDS = [
	"personal",
	"private",
	"secret",
	"intimate",
	"partner",
	"spouse",
	"married",
	"children",
	"kids",
	"password",
	"authentication",
] as const;

const RELATIONSHIP_TYPE_KEYWORDS = new Set<string>([
	"relationship",
	"friend",
	"colleague",
	"boss",
	"manager",
	"coworker",
	"partner",
	"spouse",
	"parent",
	"sibling",
]);

function matchesKeywords(text: string, keywords: readonly string[]): boolean {
	const lower = text.toLowerCase();
	for (const kw of keywords) {
		if (lower.includes(kw)) {
			return true;
		}
	}
	return false;
}

export function classifySensitivity(
	candidate: MemoryCandidate,
): MemorySensitivity {
	const text = [candidate.value, candidate.subject ?? "", candidate.type].join(
		" ",
	);

	if (matchesKeywords(text, RESTRICTED_KEYWORDS)) {
		return "restricted";
	}

	if (matchesKeywords(text, SENSITIVE_KEYWORDS)) {
		return "sensitive";
	}

	return "normal";
}

export function shouldAutoSave(proposal: MemoryProposal): boolean {
	if (proposal.sensitivity !== "normal") {
		return false;
	}

	if (proposal.confidence < 0.8) {
		return false;
	}

	if (proposal.candidate.type === "preference") {
		return true;
	}

	if (proposal.candidate.type === "fact" && proposal.confidence >= 0.9) {
		return true;
	}

	return false;
}

export function suggestVisibility(
	sensitivity: MemorySensitivity,
	type: MemoryType,
	isExplicitlyStated: boolean,
): MemoryVisibility {
	if (sensitivity === "restricted") {
		return "requires_confirmation";
	}

	if (sensitivity === "sensitive") {
		return "requires_confirmation";
	}

	if (type === "relationship" && !isExplicitlyStated) {
		return "requires_confirmation";
	}

	return "usable_by_ai";
}

export function detectExplicitStatement(value: string): boolean {
	const lower = value.toLowerCase();
	const explicitPatterns = [
		"i prefer",
		"i like",
		"i want",
		"i need",
		"i always",
		"i never",
		"i am",
		"i'm",
		"my name is",
		"my preference",
		"please remember",
		"don't forget",
		"note that i",
	];
	return explicitPatterns.some((p) => lower.includes(p));
}
