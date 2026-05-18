import chalk from "chalk";
import { formatPersonaAiLabel } from "../../ai/model-factory";
import { runSharedChatTurn } from "../../chat-pipeline/run-turn";
import type { CredentialsFile } from "../../config/index";
import { readConfig, writeConfig } from "../../config/index";
import type {
	ChatRunOptions,
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
} from "../types";
import {
	isAppleCalendarPlatformSupported,
	listCalendarsSync,
	searchCalendarEventsSync,
	testAppleCalendarConnection,
} from "./client";
import {
	buildAppleCalendarChatSystemMessage,
	buildAppleCalendarChatUserMessage,
} from "./prompts/chat";
import {
	type AppleCalendarToolContext,
	createAppleCalendarTools,
} from "./tools";

function isAppleCalendarConnectedConfig(): boolean {
	const cfg = readConfig();
	return Boolean(cfg.integrations?.applecalendar);
}

const applecalendarLifecycle = {
	name: "applecalendar" as const,
	displayName: "Apple Calendar",
	description:
		"Manage local Calendar.app on macOS — search, create, update, and delete events via automation",

	async connect(): Promise<void> {
		if (!isAppleCalendarPlatformSupported()) {
			console.log(
				chalk.yellow("Apple Calendar integration is only available on macOS."),
			);
			return;
		}

		const config = readConfig();
		if (config.integrations?.applecalendar) {
			console.log(
				chalk.yellow(
					"Apple Calendar is already connected. Disconnect first to reconnect.",
				),
			);
			return;
		}

		console.log(
			chalk.cyan("Connecting Apple Calendar (local Calendar.app)..."),
		);
		try {
			await testAppleCalendarConnection();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Could not reach Calendar.app: ${message}`);
		}

		config.integrations = {
			...config.integrations,
			applecalendar: { connectedAt: new Date().toISOString() },
		};
		writeConfig(config);
		console.log(chalk.green("Apple Calendar connected successfully!"));
	},

	async isConnected(): Promise<boolean> {
		return isAppleCalendarConnectedConfig();
	},

	async testConnection() {
		if (!isAppleCalendarPlatformSupported()) {
			return {
				ok: false,
				details: "Apple Calendar is only available on macOS.",
			};
		}

		const connected = await applecalendarLifecycle.isConnected();
		if (!connected) {
			return {
				ok: false,
				details:
					"Apple Calendar is not connected. Run `toby connect applecalendar` on this Mac first.",
			};
		}

		try {
			await testAppleCalendarConnection();
			const toolChecks = await validateAppleCalendarTools();
			const failed = toolChecks.filter((c) => !c.ok);
			return {
				ok: failed.length === 0,
				details:
					failed.length === 0
						? `Calendar.app reachable; validated ${toolChecks.length} tool check(s).`
						: `Connected, but ${failed.length}/${toolChecks.length} tool check(s) failed.`,
				tools: toolChecks,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				ok: false,
				details: `Calendar.app check failed: ${message}`,
			};
		}
	},

	async disconnect(): Promise<void> {
		const config = readConfig();
		if (!config.integrations?.applecalendar) {
			console.log(chalk.yellow("Apple Calendar is not connected."));
			return;
		}
		const next = { ...config.integrations };
		if ("applecalendar" in next) {
			Reflect.deleteProperty(next, "applecalendar");
		}
		config.integrations = next;
		writeConfig(config);
		console.log(chalk.green("Apple Calendar disconnected."));
	},
};

function getCredentialDescriptors(): CredentialFieldDescriptor[] {
	return [
		{
			key: "applecalendar.info",
			label: "Notes (optional)",
			multiline: true,
			masked: false,
		},
	];
}

function seedCredentialValues(creds: CredentialsFile): Record<string, string> {
	const note =
		creds.integrations?.applecalendar?.info?.trim() ||
		"No API keys required — uses Calendar.app on this Mac via automation.";
	return { "applecalendar.info": note };
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	const info =
		values["applecalendar.info"] ??
		previous.integrations?.applecalendar?.info ??
		seedCredentialValues(previous)["applecalendar.info"] ??
		"";
	return {
		integrations: {
			...(previous.integrations ?? {}),
			applecalendar: {
				...(previous.integrations?.applecalendar ?? {}),
				info,
			},
		},
	};
}

const CHAT_MUTATING_APPLECALENDAR_TOOLS = new Set([
	"createCalendarEvent",
	"updateCalendarEvent",
	"deleteCalendarEvent",
]);

async function chat(options: ChatRunOptions): Promise<void> {
	const persona = options.personaForModel;
	const dryRun = options.dryRun;
	const maxResults = options.maxResults;

	console.log(chalk.cyan(`Apple Calendar chat (persona "${persona.name}")...`));
	console.log(chalk.dim(`  AI: ${formatPersonaAiLabel(persona)}`));
	if (persona.instructions) {
		console.log(chalk.dim(`  Instructions: ${persona.instructions}`));
	}
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log(chalk.dim(`  Goal: ${options.prompt}`));
	console.log();

	if (!isAppleCalendarPlatformSupported()) {
		console.log(chalk.red("Apple Calendar chat requires macOS."));
		return;
	}

	const messages = [
		buildAppleCalendarChatSystemMessage(persona),
		buildAppleCalendarChatUserMessage(options.prompt),
	];

	console.log(chalk.cyan("Running assistant…\n"));

	const result = await runSharedChatTurn(
		[applecalendarIntegrationModule],
		messages,
		{
			persona,
			dryRun,
			maxResults,
		},
	);

	for (const action of result.appliedActions) {
		console.log(chalk.green(`+ ${action}`));
	}

	const mutating = result.toolCalls.filter((tc) =>
		CHAT_MUTATING_APPLECALENDAR_TOOLS.has(tc.name),
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

export const applecalendarIntegrationModule: IntegrationModule = {
	...applecalendarLifecycle,
	capabilities: ["chat"],
	providerCategories: ["calendar"],
	resources: ["calendars", "events"],
	chatReadiness: async () => {
		if (!isAppleCalendarPlatformSupported()) {
			return {
				ok: false,
				hint: "Apple Calendar is only available on macOS.",
			};
		}
		if (await applecalendarLifecycle.isConnected()) {
			return { ok: true };
		}
		return {
			ok: false,
			hint: "Run `toby connect applecalendar` on this Mac to enable local Calendar.app tools.",
		};
	},
	createChatTools: ({ dryRun, maxResults }) => {
		const ctx: AppleCalendarToolContext = {
			dryRun,
			appliedActions: [],
			maxResults,
		};
		return {
			tools: createAppleCalendarTools(ctx),
			appliedActions: ctx.appliedActions,
		};
	},
	chatModelPrep: {
		systemPromptSection: `### Apple Calendar
You assist with local Apple Calendar via Calendar.app. Use Apple Calendar tools to search, view, create, update, or delete events by uid. Calendar uses local macOS calendars; some iCloud or Exchange calendars may have sync delays. Never claim success unless the tool returned success.`,
		async buildSingleSessionMessages(persona, userPrompt) {
			return [
				buildAppleCalendarChatSystemMessage(persona),
				buildAppleCalendarChatUserMessage(userPrompt),
			];
		},
		async buildMultiUserContent(userPrompt) {
			return `## Apple Calendar
Use Apple Calendar tools for calendar operations on this Mac.

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

async function validateAppleCalendarTools(): Promise<IntegrationToolHealth[]> {
	const checks: IntegrationToolHealth[] = [];

	if (!isAppleCalendarPlatformSupported()) {
		return [
			{
				tool: "searchCalendarEvents",
				ok: false,
				details: "Not on macOS.",
			},
		];
	}

	try {
		const sample = searchCalendarEventsSync({ limit: 1 });
		checks.push({
			tool: "searchCalendarEvents",
			ok: true,
			details: `Search completed (${sample.length} match sample).`,
		});
	} catch (error) {
		checks.push({
			tool: "searchCalendarEvents",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		const calendars = listCalendarsSync();
		checks.push({
			tool: "listCalendars",
			ok: calendars.length > 0,
			details:
				calendars.length > 0
					? `Listed ${calendars.length} calendar(s).`
					: "No calendars returned (check Calendar.app).",
		});
	} catch (error) {
		checks.push({
			tool: "listCalendars",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	checks.push({
		tool: "getCalendarEvent",
		ok: true,
		details: "Not executed; requires an event uid from searchCalendarEvents.",
	});
	checks.push({
		tool: "createCalendarEvent",
		ok: true,
		details:
			"Not executed; event creation requires explicit user action in chat.",
	});
	checks.push({
		tool: "updateCalendarEvent",
		ok: true,
		details:
			"Not executed; event updates require a uid from searchCalendarEvents or createCalendarEvent.",
	});
	checks.push({
		tool: "deleteCalendarEvent",
		ok: true,
		details:
			"Not executed; event deletion requires a uid from searchCalendarEvents or createCalendarEvent.",
	});

	return checks;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
