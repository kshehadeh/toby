import chalk from "chalk";
import { withAskUserTool } from "../../ai/ask-user-tool";
import type { CoreMessage } from "../../ai/chat";
import { chatWithTools, createModelForPersona } from "../../ai/chat";
import type { Persona } from "../../config/index";
import { fetchUnreadInbox } from "./client";
import { buildEmailUserMessage, buildSystemMessage } from "./prompts/organize";
import { type EmailContext, createGmailTools } from "./tools";

const MUTATING_GMAIL_TOOLS = new Set([
	"createAndApplyLabel",
	"applyMultipleLabels",
	"markAsRead",
	"archiveEmail",
	"archiveEmailById",
	"markAsReadById",
	"applyMultipleLabelsByMessageId",
]);

export async function organizeGmailInbox(params: {
	readonly maxResults: number;
	readonly dryRun: boolean;
	readonly personaForModel: Persona;
}): Promise<void> {
	const maxResults = params.maxResults;
	const dryRun = params.dryRun;
	const persona = params.personaForModel;

	console.log(
		chalk.cyan(`Organizing Gmail inbox with persona "${persona.name}"...`),
	);
	console.log(chalk.dim(`  AI: ${persona.ai.provider}/${persona.ai.model}`));
	if (persona.instructions) {
		console.log(chalk.dim(`  Instructions: ${persona.instructions}`));
	}
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log();

	console.log(chalk.cyan(`Fetching up to ${maxResults} unread emails...`));
	const messages = await fetchUnreadInbox(maxResults);
	if (messages.length === 0) {
		console.log(chalk.green("No unread emails in your inbox!"));
		return;
	}
	console.log(chalk.dim(`Found ${messages.length} unread email(s)\n`));

	const model = createModelForPersona(persona);
	const conversation: CoreMessage[] = [buildSystemMessage(persona)];
	const ctx: EmailContext = {
		currentEmail: null,
		dryRun,
		appliedActions: [],
	};
	const tools = withAskUserTool(createGmailTools(ctx));

	for (let i = 0; i < messages.length; i++) {
		const email = messages[i];
		ctx.currentEmail = email;

		console.log(
			chalk.dim(`[${i + 1}/${messages.length}] `) +
				chalk.white(email.subject || "(no subject)"),
		);

		conversation.push(buildEmailUserMessage(email));

		const result = await chatWithTools(model, conversation, tools);
		const appliedActionsForEmail = [...ctx.appliedActions];
		const mutatingToolCalls = result.toolCalls.filter((tc) =>
			MUTATING_GMAIL_TOOLS.has(tc.name),
		);
		const confirmedMutation = appliedActionsForEmail.length > 0;

		for (const action of appliedActionsForEmail) {
			console.log(chalk.green(`  + ${action}`));
		}
		ctx.appliedActions.length = 0;

		if (!confirmedMutation) {
			const noChangeExplanation = extractNoChangeExplanation(result.text);
			if (noChangeExplanation) {
				console.log(
					chalk.yellow(`  ! No changes made: ${noChangeExplanation}`),
				);
			}
			if (mutatingToolCalls.length > 0) {
				console.log(
					chalk.yellow(
						"  ! Attempted inbox changes, but no successful Gmail modification was confirmed.",
					),
				);
			} else if (!noChangeExplanation) {
				console.log(
					chalk.yellow(
						"  ! No inbox changes were applied because no mutating tool calls were made.",
					),
				);
			}
		}

		if (result.text && confirmedMutation) {
			console.log(chalk.dim(`  ${result.text}`));
		}

		for (const tc of result.toolCalls) {
			console.log(chalk.blue(`  -> ${tc.name}(${formatArgs(tc.args)})`));
		}

		conversation.push({
			role: "assistant",
			content:
				result.text ||
				`Applied tools: ${result.toolCalls.map((tc) => tc.name).join(", ")}`,
		});
		console.log();
	}

	console.log(chalk.green(`Done! Processed ${messages.length} email(s).`));
}

function formatArgs(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
		.join(", ");
}

function extractNoChangeExplanation(text: string): string | null {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return null;
	}

	const lower = normalized.toLowerCase();
	const hasNoChangeCue =
		lower.includes("no changes") ||
		lower.includes("no change") ||
		lower.includes("did not make changes") ||
		lower.includes("didn't make changes");

	const hasActionClaim =
		lower.includes("applied") ||
		lower.includes("archived") ||
		lower.includes("labeled") ||
		lower.includes("labelled") ||
		lower.includes("marked as read") ||
		lower.includes("organized");

	if (!hasNoChangeCue || hasActionClaim) {
		return null;
	}

	return normalized;
}
