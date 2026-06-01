import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { type Tool, tool } from "ai";
import { z } from "zod";

const askUserInputSchema = z.object({
	query: z.string().describe("Question to show the user"),
	options: z
		.array(z.string())
		.min(1)
		.describe("Fixed choices for the user (they pick one)"),
});

export type AskUserToolResult = {
	selectedIndex: number;
	selectedLabel: string;
	rawInput: string;
	error?: string;
};

/** Custom handler (e.g. Ink UI); when omitted, readline is used. */
export type AskUserHandler = (payload: {
	query: string;
	options: string[];
}) => Promise<AskUserToolResult>;

async function readlineAskUser(payload: {
	query: string;
	options: string[];
}): Promise<AskUserToolResult> {
	const { query, options: choices } = payload;
	const rl = createInterface({ input, output, terminal: true });
	try {
		console.log();
		console.log(query);
		for (let i = 0; i < choices.length; i++) {
			console.log(`  ${i + 1}) ${choices[i]}`);
		}
		const raw = (
			await rl.question("Choose (number or exact option text): ")
		).trim();

		let selectedIndex = -1;
		let selectedLabel = "";

		const asNum = Number.parseInt(raw, 10);
		if (
			raw !== "" &&
			!Number.isNaN(asNum) &&
			asNum >= 1 &&
			asNum <= choices.length
		) {
			selectedIndex = asNum - 1;
			selectedLabel = choices[selectedIndex] ?? "";
		} else {
			const idx = choices.findIndex(
				(c) => c.toLowerCase() === raw.toLowerCase(),
			);
			if (idx >= 0) {
				selectedIndex = idx;
				selectedLabel = choices[idx] ?? "";
			}
		}

		if (selectedIndex < 0 || !selectedLabel) {
			return {
				selectedIndex: -1,
				selectedLabel: "",
				rawInput: raw,
				error: "Invalid choice; ask again with the same options or rephrase.",
			};
		}

		return {
			selectedIndex,
			selectedLabel,
			rawInput: raw,
		};
	} finally {
		rl.close();
	}
}

/**
 * Tool the model can call to ask the user a multiple-choice question in the CLI.
 * The return value is fed back into the same `generateText` / tool loop.
 */
function createAskUserTool(handler?: AskUserHandler): Tool {
	return tool({
		description:
			"Ask User (required for any user choice): This CLI only collects answers through this tool. Do not ask yes/no or multiple-choice questions only in assistant text—the user will not see an interactive prompt. Call askUser with a short query and a non-empty options array; the user picks one in the terminal and the choice is returned to you. Use before ambiguous destructive work, or when you genuinely need a decision. If the request is already fully answered, reply concisely and do not add rhetorical follow-up questions in text.",
		inputSchema: askUserInputSchema,
		execute: async ({ query, options: choices }) => {
			if (handler) {
				return handler({ query, options: choices });
			}
			return readlineAskUser({ query, options: choices });
		},
	});
}

/** Merge integration tools with the shared Ask User tool for tool-calling flows. */
export function withAskUserTool<T extends Record<string, Tool>>(
	tools: T,
	handler?: AskUserHandler,
): T & { askUser: Tool } {
	return {
		...tools,
		askUser: createAskUserTool(handler),
	};
}
