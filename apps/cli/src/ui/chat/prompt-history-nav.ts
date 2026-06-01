export interface PromptHistoryBrowseState {
	readonly browseIndex: number;
	readonly draft: string;
}

export interface PromptHistoryNavigationResult {
	readonly browseIndex: number;
	readonly draft: string;
	readonly value: string;
}

/**
 * Resolve up/down navigation through recent prompts when the input is empty.
 * browseIndex -1 means not browsing; otherwise indexes into `prompts` (0 = oldest).
 */
export function navigatePromptHistory(
	direction: "up" | "down",
	state: PromptHistoryBrowseState,
	prompts: readonly string[],
): PromptHistoryNavigationResult | null {
	if (prompts.length === 0) {
		return null;
	}

	if (direction === "up") {
		if (state.browseIndex === -1) {
			const index = prompts.length - 1;
			return {
				browseIndex: index,
				draft: state.draft,
				value: prompts[index] ?? "",
			};
		}
		if (state.browseIndex > 0) {
			const index = state.browseIndex - 1;
			return {
				browseIndex: index,
				draft: state.draft,
				value: prompts[index] ?? "",
			};
		}
		return {
			browseIndex: state.browseIndex,
			draft: state.draft,
			value: prompts[state.browseIndex] ?? "",
		};
	}

	if (state.browseIndex === -1) {
		return null;
	}

	if (state.browseIndex < prompts.length - 1) {
		const index = state.browseIndex + 1;
		return {
			browseIndex: index,
			draft: state.draft,
			value: prompts[index] ?? "",
		};
	}

	return {
		browseIndex: -1,
		draft: state.draft,
		value: state.draft,
	};
}

export function isPromptHistoryEligibleInput(value: string): boolean {
	return value.trim().length === 0;
}
