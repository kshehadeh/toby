/**
 * Keep only the user-facing summary when a model dumps planning / chain-of-thought
 * into the main text (common with some reasoning models via generateText).
 *
 * Prefer the final answer after markdown headings or after explicit "here is the
 * summary" transitions when the preamble looks like internal monologue.
 * If the entire payload is planning with no salvageable summary, returns "".
 */
export function extractUserFacingText(raw: string): string {
	let text = raw.trim();
	if (!text) return text;

	// Tagged reasoning / meta blocks (DeepSeek/Qwen, Grok-style, skill dumps).
	text = text
		.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, "")
		.replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, "")
		.replace(
			/<fidelity[-_]?matrix\b[^>]*>[\s\S]*?<\/fidelity[-_]?matrix>/gi,
			"",
		)
		.replace(/<\/?(?:skill|invoke|tool_call|antml)\b[^>]*>/gi, "")
		// Unclosed / truncated think tags (stream cut off mid-reasoning).
		.replace(/<think(?:ing)?\b[^>]*>[\s\S]*$/gi, "")
		.replace(/<reasoning\b[^>]*>[\s\S]*$/gi, "")
		.replace(/<fidelity[-_]?matrix\b[^>]*>[\s\S]*$/gi, "")
		// Single-line "skill name=..." crumbs (do not use \s* after the value —
		// \s matches newlines and would swallow the real summary).
		.replace(
			/^[ \t]*skill\s+name\s*=\s*["']?[\w.-]+["']?[ \t]*>?[ \t]*$/gim,
			"",
		)
		.trim();

	// Drop leading meta lines that look like tables or requirement matrices.
	text = stripLeadingMetaPreamble(text);

	// Planning first, then markdown sections (## / # headings).
	const headingMatch = /^(#{1,3}\s+\S)/m.exec(text);
	if (headingMatch?.index != null && headingMatch.index > 0) {
		const before = text.slice(0, headingMatch.index).trim();
		const after = text.slice(headingMatch.index).trim();
		if (
			before.length >= 40 &&
			(looksLikeModelPlanning(before) || looksLikeMetaLeak(before)) &&
			after.length > 0 &&
			!looksLikeModelPlanning(after) &&
			!looksLikeMetaLeak(after)
		) {
			return after;
		}
	}

	// Case-insensitive "Needs attention" style sections without markdown hashes
	// (models sometimes emit plain ALL CAPS headers after a CoT preamble).
	const sectionMatch =
		/^(#{0,3}\s*)?(needs attention|worth mentioning|today|tomorrow|later)\b/im.exec(
			text,
		);
	if (sectionMatch?.index != null && sectionMatch.index > 0) {
		const before = text.slice(0, sectionMatch.index).trim();
		const after = text.slice(sectionMatch.index).trim();
		if (
			before.length >= 20 &&
			(looksLikeModelPlanning(before) || looksLikeMetaLeak(before)) &&
			after.length > 0 &&
			!looksLikeMetaLeak(after)
		) {
			return after;
		}
	}

	// Explicit transition into the final answer.
	const transition =
		/\n(?:I(?:'ll| will) write|Final (?:answer|summary)|Here(?:'s| is) (?:the )?(?:summary|response)|Output|Draft(?:ed)? summary)\s*[:：]?\s*\n+/i.exec(
			text,
		);
	if (transition?.index != null) {
		const after = text.slice(transition.index + transition[0].length).trim();
		if (
			after.length >= 40 &&
			!looksLikeModelPlanning(after) &&
			!looksLikeMetaLeak(after)
		) {
			return after;
		}
	}

	// Whole response is internal monologue or leaked metadata (no summary).
	if (looksLikeModelPlanning(text) || looksLikeMetaLeak(text)) {
		return "";
	}

	return text;
}

/** Drop leading lines that look like requirement matrices / skill tables. */
function stripLeadingMetaPreamble(text: string): string {
	const lines = text.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]?.trim() ?? "";
		if (!line) {
			i++;
			continue;
		}
		const isMetaLine =
			/^(category\s*\|\s*requirement|requirement\s*\|\s*source|fidelity[-_]?matrix|skill\s+name\s*=)/i.test(
				line,
			) ||
			/^[\w\s]+\|\s*[\w\s]+\|\s*[\w\s]+/.test(line) ||
			/^<\/?[a-z][\w:-]*\b[^>]*>$/i.test(line);
		if (!isMetaLine) break;
		i++;
	}
	if (i === 0) return text;
	return lines.slice(i).join("\n").trim();
}

/** Heuristic: text is skill/XML/meta leakage rather than a summary. */
function looksLikeMetaLeak(text: string): boolean {
	const patterns = [
		/<fidelity[-_]?matrix\b/i,
		/\bskill\s+name\s*=/i,
		/\bCategory\s*\|\s*Requirement\b/i,
		/\bRequirement\s*\|\s*Source\b/i,
		/<\/?(?:think(?:ing)?|reasoning|skill|invoke)\b/i,
		/\bAvailable skills\s*\(apply relevant/i,
	];
	return patterns.some((re) => re.test(text));
}

/** Heuristic: text reads like model planning rather than a user-facing summary. */
function looksLikeModelPlanning(text: string): boolean {
	const patterns = [
		/\bwe need to\b/i,
		/\blet'?s\b/i,
		/\bi(?:'ll| will)\b/i,
		/\bthe user (?:provided|says|asks|said)\b/i,
		/\bfor example, item\b/i,
		/\bi can (?:see|infer|compute)\b/i,
		/\bfocusing on\b/i,
		/\bcurrent date is not given\b/i,
		/\bstructure\b/i,
		/\bthe instruction\b/i,
		/\binstruction says\b/i,
		/\bso we need to\b/i,
		/\balso note\b/i,
		/\blet'?s count\b/i,
		/\btotal sentences\b/i,
		/\bthat'?s (?:more|less) than\b/i,
		/\bsentence \d+\s*:/i,
		/\bi recall\b/i,
		/\blet me try\b/i,
		/\bneed to condense\b/i,
		/\bwe should (?:write|structure|mention|cover)\b/i,
		/\bdo not go beyond\b/i,
		/\bactually it'?s\b/i,
		/\bbetter:\s/i,
		/\breasoning\b/i,
		/\bchain[- ]of[- ]thought\b/i,
	];
	const hits = patterns.filter((re) => re.test(text)).length;
	// Require 2+ hits so real summaries that say "let's" once still pass.
	return hits >= 2;
}
