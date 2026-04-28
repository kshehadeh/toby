import chalk from "chalk";
import type { CredentialsFile } from "../../config/index";
import {
	getGmailCredentials,
	readConfig,
	writeConfig,
} from "../../config/index";
import type {
	ChatRunOptions,
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
	SummarizeRunOptions,
	SummarizeRunResult,
} from "../types";
import { runOAuthFlow } from "./auth";
import { runGmailChatTurn } from "./chat-turn";
import {
	fetchUnreadInbox,
	getGmailGrantedScopes,
	listInboxUnreadPage,
	testGmailConnection,
} from "./client";
import { organizeGmailInbox } from "./organize";
import {
	buildGmailChatSystemMessage,
	buildGmailChatUserMessage,
} from "./prompts/chat";
import {
	buildGmailSummarySystemMessage,
	buildGmailSummaryUserMessage,
} from "./prompts/summarize";
import { type EmailContext, createGmailTools } from "./tools";

const gmailLifecycle = {
	name: "gmail" as const,
	displayName: "Gmail",
	description: "Connect to your Gmail account to read and organize email",

	async connect(): Promise<void> {
		const config = readConfig();
		if (config.integrations.gmail) {
			console.log(
				chalk.yellow(
					"Gmail is already connected. Disconnect first to reconnect.",
				),
			);
			return;
		}

		console.log(chalk.cyan("Connecting Gmail..."));
		console.log(
			chalk.dim("Ensure your credentials are in ~/.toby/credentials.json"),
		);

		const credentials = getGmailCredentials();
		const tokens = await runOAuthFlow(credentials);

		config.integrations.gmail = tokens;
		writeConfig(config);

		console.log(chalk.green("Gmail connected successfully!"));
	},

	async isConnected(): Promise<boolean> {
		const config = readConfig();
		return !!config.integrations.gmail;
	},

	async testConnection() {
		const connected = await gmailLifecycle.isConnected();
		if (!connected) {
			return {
				ok: false,
				details: "Gmail is not connected. Run `toby connect gmail` first.",
			};
		}

		try {
			await testGmailConnection();
			const toolChecks = await validateGmailTools();
			const failedChecks = toolChecks.filter((check) => !check.ok);

			return {
				ok: failedChecks.length === 0,
				details:
					failedChecks.length === 0
						? `Successfully authenticated and validated ${toolChecks.length}/${toolChecks.length} tools.`
						: `Connected, but ${failedChecks.length}/${toolChecks.length} tool checks failed.`,
				tools: toolChecks,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				ok: false,
				details: `Connected, but Gmail API check failed: ${message}`,
			};
		}
	},

	async disconnect(): Promise<void> {
		const config = readConfig();
		if (!config.integrations.gmail) {
			console.log(chalk.yellow("Gmail is not connected."));
			return;
		}
		Reflect.deleteProperty(config.integrations, "gmail");
		writeConfig(config);
		console.log(chalk.green("Gmail disconnected."));
	},
};

function getCredentialDescriptors(): CredentialFieldDescriptor[] {
	return [
		{ key: "gmail.clientId", label: "Client ID", masked: false },
		{ key: "gmail.clientSecret", label: "Client Secret", masked: true },
	];
}

function seedCredentialValues(creds: CredentialsFile): Record<string, string> {
	const out: Record<string, string> = {};
	const clientId =
		creds.integrations?.gmail?.clientId?.trim() ||
		creds.gmail?.clientId?.trim();
	const clientSecret =
		creds.integrations?.gmail?.clientSecret?.trim() ||
		creds.gmail?.clientSecret?.trim();
	if (clientId) out["gmail.clientId"] = clientId;
	if (clientSecret) out["gmail.clientSecret"] = clientSecret;
	return out;
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	const clientId =
		values["gmail.clientId"] ??
		previous.integrations?.gmail?.clientId ??
		previous.gmail?.clientId ??
		"";
	const clientSecret =
		values["gmail.clientSecret"] ??
		previous.integrations?.gmail?.clientSecret ??
		previous.gmail?.clientSecret ??
		"";
	return {
		integrations: {
			...(previous.integrations ?? {}),
			gmail: {
				...(previous.integrations?.gmail ?? {}),
				clientId,
				clientSecret,
			},
		},
		gmail: {
			clientId,
			clientSecret,
		},
	};
}

const CHAT_MUTATING_GMAIL_TOOLS = new Set([
	"createAndApplyLabel",
	"applyMultipleLabels",
	"markAsRead",
	"archiveEmail",
	"archiveEmailById",
	"markAsReadById",
	"applyMultipleLabelsByMessageId",
]);

async function summarize(
	options: SummarizeRunOptions,
): Promise<SummarizeRunResult> {
	const emails = await fetchUnreadInbox(options.maxResults);
	if (emails.length === 0) {
		return { status: "empty", message: "No unread emails in your inbox." };
	}
	const messages = [
		buildGmailSummarySystemMessage(options.summaryPersona),
		buildGmailSummaryUserMessage(emails),
	];
	return { status: "ok", messages };
}

async function chat(options: ChatRunOptions): Promise<void> {
	const maxResults = options.maxResults;
	const dryRun = options.dryRun;
	const persona = options.personaForModel;

	console.log(chalk.cyan(`Gmail chat (persona "${persona.name}")...`));
	console.log(chalk.dim(`  AI: ${persona.ai.provider}/${persona.ai.model}`));
	if (persona.instructions) {
		console.log(chalk.dim(`  Instructions: ${persona.instructions}`));
	}
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log(chalk.dim(`  Goal: ${options.prompt}`));
	console.log(
		chalk.dim(
			maxResults === undefined
				? "  Inbox overview tools: up to 500 ids per Gmail page (use nextPageToken for more)."
				: `  List sample cap (for overview tools): up to ${Math.min(maxResults, 500)} ids per list page`,
		),
	);
	console.log();

	const peek = await listInboxUnreadPage(1);
	if (peek.pageSize === 0) {
		console.log(chalk.dim("Inbox has no unread messages (quick check)."));
		console.log(
			chalk.dim(
				"The assistant can still run if your question is about labels or other topics.\n",
			),
		);
	}

	const messages = [
		buildGmailChatSystemMessage(persona),
		buildGmailChatUserMessage(options.prompt),
	];

	console.log(chalk.cyan("Running assistant…\n"));

	const result = await runGmailChatTurn({
		messages,
		persona,
		dryRun,
		maxResults,
	});

	for (const action of result.appliedActions) {
		console.log(chalk.green(`+ ${action}`));
	}

	const mutatingToolCalls = result.toolCalls.filter((tc) =>
		CHAT_MUTATING_GMAIL_TOOLS.has(tc.name),
	);
	const confirmedMutation = result.appliedActions.length > 0;

	if (!confirmedMutation && mutatingToolCalls.length > 0) {
		console.log(
			chalk.yellow(
				"! Mutating tools were invoked but no successful modification was recorded (check errors above).",
			),
		);
	}

	for (const tc of result.toolCalls) {
		console.log(chalk.blue(`-> ${tc.name}(${formatChatArgs(tc.args)})`));
	}

	if (result.text?.trim()) {
		console.log();
		console.log(chalk.bold("Assistant"));
		console.log(result.text.trim());
	}

	console.log();
	console.log(chalk.green("Done."));
}

function formatChatArgs(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
		.join(", ");
}

export const gmailIntegrationModule: IntegrationModule = {
	...gmailLifecycle,
	capabilities: ["summarize", "organize", "chat"],
	resources: ["inbox", "labels", "messages"],
	chatReadiness: async (creds) => {
		const connected = await gmailLifecycle.isConnected();
		if (connected) return { ok: true };
		const hasClientCreds = Boolean(
			creds.gmail?.clientId && creds.gmail?.clientSecret,
		);
		return {
			ok: false,
			hint: hasClientCreds
				? "Run `toby connect gmail` to authenticate."
				: "Add Gmail clientId/clientSecret in `toby configure`, then run `toby connect gmail`.",
		};
	},
	organize: async ({ maxResults, dryRun, personaForModel }) => {
		await organizeGmailInbox({ maxResults, dryRun, personaForModel });
	},
	createChatTools: ({ dryRun, maxResults }) => {
		const ctx: EmailContext = {
			currentEmail: null,
			dryRun,
			appliedActions: [],
			listSampleMax:
				maxResults === undefined
					? undefined
					: Math.min(Math.max(1, maxResults), 500),
		};
		return { tools: createGmailTools(ctx), appliedActions: ctx.appliedActions };
	},
	runChatTurn: runGmailChatTurn,
	chatModelPrep: {
		systemPromptSection: `### Gmail
You are assisting with Gmail. Use Gmail tools to inspect or change the mailbox. Prefer holistic inbox overview before loading many messages. Never claim a mutation succeeded unless the corresponding Gmail tool succeeded.`,
		async buildSingleSessionMessages(persona, userPrompt) {
			return [
				buildGmailChatSystemMessage(persona),
				buildGmailChatUserMessage(userPrompt),
			];
		},
		async buildMultiUserContent(userPrompt) {
			return `## Gmail
Carry out the Gmail parts of the request using Gmail tools as needed. Prefer inbox overview before loading many full messages.

If you need a decision from the user, call **askUser** with options.

User request (may also mention other integrations):
${userPrompt || "(no additional text — follow the system instruction.)"}`;
		},
	},
	getCredentialDescriptors,
	seedCredentialValues,
	mergeCredentialsPatch,
	summarize,
	chat,
};

async function validateGmailTools(): Promise<IntegrationToolHealth[]> {
	const checks: IntegrationToolHealth[] = [];

	try {
		await fetchUnreadInbox(1);
		checks.push({
			tool: "getRecentEmails",
			ok: true,
			details: "Fetched inbox metadata successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "getRecentEmails",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		await listInboxUnreadPage(1);
		checks.push({
			tool: "getInboxUnreadOverview",
			ok: true,
			details: "Listed inbox unread page successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "getInboxUnreadOverview",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		const scopes = await getGmailGrantedScopes();
		const hasModifyScope = scopes.includes(
			"https://www.googleapis.com/auth/gmail.modify",
		);

		checks.push({
			tool: "listLabels",
			ok: true,
			details: "Authenticated and token scopes resolved.",
		});
		checks.push({
			tool: "createAndApplyLabel",
			ok: hasModifyScope,
			details: hasModifyScope
				? "gmail.modify scope is present."
				: "Missing required gmail.modify scope.",
		});
		checks.push({
			tool: "applyMultipleLabels",
			ok: hasModifyScope,
			details: hasModifyScope
				? "gmail.modify scope is present."
				: "Missing required gmail.modify scope.",
		});
		checks.push({
			tool: "markAsRead",
			ok: hasModifyScope,
			details: hasModifyScope
				? "gmail.modify scope is present."
				: "Missing required gmail.modify scope.",
		});
		checks.push({
			tool: "archiveEmail",
			ok: hasModifyScope,
			details: hasModifyScope
				? "gmail.modify scope is present."
				: "Missing required gmail.modify scope.",
		});
	} catch (error) {
		const message = `Could not validate token scopes: ${toErrorMessage(error)}`;
		checks.push({
			tool: "listLabels",
			ok: false,
			details: message,
		});
		checks.push({
			tool: "createAndApplyLabel",
			ok: false,
			details: message,
		});
		checks.push({
			tool: "applyMultipleLabels",
			ok: false,
			details: message,
		});
		checks.push({
			tool: "markAsRead",
			ok: false,
			details: message,
		});
		checks.push({
			tool: "archiveEmail",
			ok: false,
			details: message,
		});
	}

	return checks;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
