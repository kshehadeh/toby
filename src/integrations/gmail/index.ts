import chalk from "chalk";
import type { CredentialsFile } from "../../config/index";
import {
	getGmailCredentials,
	readConfig,
	writeConfig,
} from "../../config/index";
import type {
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
	SummarizeRunOptions,
	SummarizeRunResult,
} from "../types";
import { runOAuthFlow } from "./auth";
import {
	fetchUnreadInbox,
	getGmailGrantedScopes,
	testGmailConnection,
} from "./client";
import {
	buildGmailSummarySystemMessage,
	buildGmailSummaryUserMessage,
} from "./prompts/summarize";

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
	if (creds.gmail?.clientId) out["gmail.clientId"] = creds.gmail.clientId;
	if (creds.gmail?.clientSecret)
		out["gmail.clientSecret"] = creds.gmail.clientSecret;
	return out;
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	return {
		gmail: {
			clientId: values["gmail.clientId"] ?? previous.gmail?.clientId ?? "",
			clientSecret:
				values["gmail.clientSecret"] ?? previous.gmail?.clientSecret ?? "",
		},
	};
}

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

export const gmailIntegrationModule: IntegrationModule = {
	...gmailLifecycle,
	capabilities: ["summarize", "organize"],
	resources: ["inbox", "labels", "messages"],
	getCredentialDescriptors,
	seedCredentialValues,
	mergeCredentialsPatch,
	summarize,
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
