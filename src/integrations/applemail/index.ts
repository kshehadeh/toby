import chalk from "chalk";
import type { CredentialsFile } from "../../config/index";
import { readConfig, writeConfig } from "../../config/index";
import type {
	ChatRunOptions,
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
} from "../types";
import { runAppleMailChatTurn } from "./chat-turn";
import {
	isAppleMailPlatformSupported,
	listAppleMailAccountsSync,
	listMailboxesSync,
	searchAppleMailEmailsSync,
	testAppleMailConnection,
} from "./client";
import {
	buildAppleMailChatSystemMessage,
	buildAppleMailChatUserMessage,
} from "./prompts/chat";
import { type AppleMailToolContext, createAppleMailTools } from "./tools";

function isAppleMailConnectedConfig(): boolean {
	const cfg = readConfig();
	return Boolean(cfg.integrations?.applemail);
}

const applemailLifecycle = {
	name: "applemail" as const,
	displayName: "Apple Mail",
	description:
		"Control local Mail.app on macOS — search messages and manage drafts via automation",

	async connect(): Promise<void> {
		if (!isAppleMailPlatformSupported()) {
			console.log(
				chalk.yellow("Apple Mail integration is only available on macOS."),
			);
			return;
		}

		const config = readConfig();
		if (config.integrations?.applemail) {
			console.log(
				chalk.yellow(
					"Apple Mail is already connected. Disconnect first to reconnect.",
				),
			);
			return;
		}

		console.log(chalk.cyan("Connecting Apple Mail (local Mail.app)..."));
		try {
			await testAppleMailConnection();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Could not reach Mail.app: ${message}`);
		}

		config.integrations = {
			...config.integrations,
			applemail: { connectedAt: new Date().toISOString() },
		};
		writeConfig(config);
		console.log(chalk.green("Apple Mail connected successfully!"));
	},

	async isConnected(): Promise<boolean> {
		return isAppleMailConnectedConfig();
	},

	async testConnection() {
		if (!isAppleMailPlatformSupported()) {
			return {
				ok: false,
				details: "Apple Mail is only available on macOS.",
			};
		}

		const connected = await applemailLifecycle.isConnected();
		if (!connected) {
			return {
				ok: false,
				details:
					"Apple Mail is not connected. Run `toby connect applemail` on this Mac first.",
			};
		}

		try {
			await testAppleMailConnection();
			const toolChecks = await validateAppleMailTools();
			const failed = toolChecks.filter((c) => !c.ok);
			return {
				ok: failed.length === 0,
				details:
					failed.length === 0
						? `Mail.app reachable; validated ${toolChecks.length} tool check(s).`
						: `Connected, but ${failed.length}/${toolChecks.length} tool check(s) failed.`,
				tools: toolChecks,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				ok: false,
				details: `Mail.app check failed: ${message}`,
			};
		}
	},

	async disconnect(): Promise<void> {
		const config = readConfig();
		if (!config.integrations?.applemail) {
			console.log(chalk.yellow("Apple Mail is not connected."));
			return;
		}
		const next = { ...config.integrations };
		if ("applemail" in next) {
			Reflect.deleteProperty(next, "applemail");
		}
		config.integrations = next;
		writeConfig(config);
		console.log(chalk.green("Apple Mail disconnected."));
	},
};

function getCredentialDescriptors(): CredentialFieldDescriptor[] {
	return [
		{
			key: "applemail.info",
			label: "Notes (optional)",
			multiline: true,
			masked: false,
		},
	];
}

function seedCredentialValues(creds: CredentialsFile): Record<string, string> {
	const note =
		creds.integrations?.applemail?.info?.trim() ||
		"No API keys required — uses Mail.app on this Mac via automation.";
	return { "applemail.info": note };
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	const info =
		values["applemail.info"] ??
		previous.integrations?.applemail?.info ??
		seedCredentialValues(previous)["applemail.info"] ??
		"";
	return {
		integrations: {
			...(previous.integrations ?? {}),
			applemail: {
				...(previous.integrations?.applemail ?? {}),
				info,
			},
		},
	};
}

const CHAT_MUTATING_APPLEMAIL_TOOLS = new Set([
	"createDraft",
	"updateDraft",
	"archiveMailMessage",
	"flagMailMessage",
	"moveMailMessage",
]);

async function chat(options: ChatRunOptions): Promise<void> {
	const persona = options.personaForModel;
	const dryRun = options.dryRun;
	const maxResults = options.maxResults;

	console.log(chalk.cyan(`Apple Mail chat (persona "${persona.name}")...`));
	console.log(chalk.dim(`  AI: ${persona.ai.provider}/${persona.ai.model}`));
	if (persona.instructions) {
		console.log(chalk.dim(`  Instructions: ${persona.instructions}`));
	}
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log(chalk.dim(`  Goal: ${options.prompt}`));
	console.log();

	if (!isAppleMailPlatformSupported()) {
		console.log(chalk.red("Apple Mail chat requires macOS."));
		return;
	}

	const messages = [
		buildAppleMailChatSystemMessage(persona),
		buildAppleMailChatUserMessage(options.prompt),
	];

	console.log(chalk.cyan("Running assistant…\n"));

	const result = await runAppleMailChatTurn({
		messages,
		persona,
		dryRun,
		maxResults,
	});

	for (const action of result.appliedActions) {
		console.log(chalk.green(`+ ${action}`));
	}

	const mutating = result.toolCalls.filter((tc) =>
		CHAT_MUTATING_APPLEMAIL_TOOLS.has(tc.name),
	);
	const confirmed = result.appliedActions.length > 0;
	if (!confirmed && mutating.length > 0) {
		console.log(
			chalk.yellow(
				"! Mutating tools ran but no successful change was recorded (check errors above).",
			),
		);
	}

	for (const tc of result.toolCalls) {
		console.log(
			chalk.blue(
				`-> ${tc.name}(${Object.entries(tc.args)
					.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
					.join(", ")})`,
			),
		);
	}

	if (result.text?.trim()) {
		console.log();
		console.log(chalk.bold("Assistant"));
		console.log(result.text.trim());
	}

	console.log();
	console.log(chalk.green("Done."));
}

export const applemailIntegrationModule: IntegrationModule = {
	...applemailLifecycle,
	capabilities: ["chat"],
	resources: ["inbox", "drafts", "messages"],
	chatReadiness: async () => {
		if (!isAppleMailPlatformSupported()) {
			return {
				ok: false,
				hint: "Apple Mail is only available on macOS.",
			};
		}
		if (await applemailLifecycle.isConnected()) {
			return { ok: true };
		}
		return {
			ok: false,
			hint: "Run `toby connect applemail` on this Mac to enable local Mail.app tools.",
		};
	},
	createChatTools: ({ dryRun, maxResults }) => {
		const ctx: AppleMailToolContext = {
			dryRun,
			appliedActions: [],
			maxResults,
		};
		return {
			tools: createAppleMailTools(ctx),
			appliedActions: ctx.appliedActions,
		};
	},
	runChatTurn: runAppleMailChatTurn,
	chatModelPrep: {
		systemPromptSection: `### Apple Mail
You assist with local Apple Mail via Mail.app. Use Apple Mail tools to search, archive, flag, move between folders, create drafts, or update drafts by numeric message id. Mail has no Gmail-style labels; folders and the built-in flag are the practical equivalents. Never claim success unless the tool returned success.`,
		async buildSingleSessionMessages(persona, userPrompt) {
			return [
				buildAppleMailChatSystemMessage(persona),
				buildAppleMailChatUserMessage(userPrompt),
			];
		},
		async buildMultiUserContent(userPrompt) {
			return `## Apple Mail
Use Apple Mail tools for mailbox operations on this Mac.

If you need a decision from the user, call **askUser** with options.

User request (may also mention other integrations):
${userPrompt || "(no additional text — follow the system instruction.)"}`;
		},
	},
	getCredentialDescriptors,
	seedCredentialValues,
	mergeCredentialsPatch,
	chat,
};

async function validateAppleMailTools(): Promise<IntegrationToolHealth[]> {
	const checks: IntegrationToolHealth[] = [];

	if (!isAppleMailPlatformSupported()) {
		return [
			{
				tool: "searchEmails",
				ok: false,
				details: "Not on macOS.",
			},
		];
	}

	try {
		const sample = searchAppleMailEmailsSync({ limit: 1, unreadOnly: true });
		checks.push({
			tool: "searchEmails",
			ok: true,
			details: `Search completed (${sample.length} unread match sample).`,
		});
	} catch (error) {
		checks.push({
			tool: "searchEmails",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		const accounts = listAppleMailAccountsSync();
		checks.push({
			tool: "listMailAccounts",
			ok: accounts.length > 0,
			details:
				accounts.length > 0
					? `Listed ${accounts.length} Mail account(s).`
					: "No accounts returned (check Mail.app).",
		});
	} catch (error) {
		checks.push({
			tool: "listMailAccounts",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		const mbs = listMailboxesSync();
		checks.push({
			tool: "listMailboxes",
			ok: mbs.length > 0,
			details:
				mbs.length > 0
					? `Listed ${mbs.length} mailbox row(s).`
					: "No mailboxes returned (check Mail.app).",
		});
	} catch (error) {
		checks.push({
			tool: "listMailboxes",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	checks.push({
		tool: "createDraft",
		ok: true,
		details:
			"Not executed; draft creation requires explicit user action in chat.",
	});
	checks.push({
		tool: "updateDraft",
		ok: true,
		details:
			"Not executed; draft updates require a draft id from search or create.",
	});
	checks.push({
		tool: "archiveMailMessage",
		ok: true,
		details: "Not executed; archiving requires a message id from search.",
	});
	checks.push({
		tool: "flagMailMessage",
		ok: true,
		details: "Not executed; flagging requires a message id from search.",
	});
	checks.push({
		tool: "moveMailMessage",
		ok: true,
		details: "Not executed; moves require a message id and mailbox name.",
	});

	return checks;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
