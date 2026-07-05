import readline from "node:readline/promises";
import { pluginToolsList } from "@toby/core/integrations/plugins/client";
import {
	PluginInstallException,
	installPlugin,
	uninstallPlugin,
} from "@toby/core/integrations/plugins/install";
import {
	CURRENT_PROTOCOL_VERSION,
	pluginDisplayPath,
	targetDisplayPath,
} from "@toby/core/integrations/plugins/protocol";
import {
	discoverPluginBinaries,
	getPluginMetadata,
	inspectPluginBinary,
	resolvePluginSearchDirectories,
} from "@toby/core/integrations/plugins/registry";
import { resolvePluginTarget } from "@toby/core/integrations/plugins/runtime";
import {
	formatPluginSetupActionLines,
	pluginSetupHasFailures,
	runPluginSetup,
} from "@toby/core/integrations/plugins/setup";
import {
	checkStandardToolCompliance,
	validatePluginBinary,
} from "@toby/core/integrations/plugins/validate";
import chalk from "chalk";
import type { Command } from "commander";

export function registerPluginsCommand(program: Command): void {
	const plugins = program
		.command("plugins")
		.description("Manage installable integration plugins");

	plugins
		.command("list")
		.description("List discovered plugin binaries")
		.action(async () => {
			await listPlugins();
		});

	plugins
		.command("install <path>")
		.description("Validate and install a plugin binary into ~/.toby/plugins/")
		.option("--force", "Overwrite an existing install in ~/.toby/plugins/")
		.option("--link", "Symlink instead of copying (useful during development)")
		.option(
			"--setup",
			"Run plugin setup after install without prompting (requires a TTY)",
		)
		.option("--no-setup", "Skip the post-install setup prompt")
		.action(
			async (
				sourcePath: string,
				options: {
					force?: boolean;
					link?: boolean;
					setup?: boolean;
					noSetup?: boolean;
				},
			) => {
				await runInstallPlugin(sourcePath, options);
			},
		);

	plugins
		.command("setup <name>")
		.description("Run one-time setup for an installed plugin")
		.action(async (name: string) => {
			await runPluginSetupCommand(name);
		});

	plugins
		.command("uninstall <name>")
		.description(
			"Remove a managed plugin and purge its credentials, config, and cached tool results",
		)
		.action(async (name: string) => {
			await runUninstallPlugin(name);
		});

	plugins
		.command("inspect <name>")
		.description("Show plugin metadata and tool catalog")
		.action(async (name: string) => {
			await inspectPlugin(name);
		});

	plugins
		.command("doctor")
		.description("Validate discovered plugins against the protocol")
		.action(async () => {
			await doctorPlugins();
		});

	plugins.action(async () => {
		await listPlugins();
	});
}

async function listPlugins(): Promise<void> {
	const discovered = discoverPluginBinaries();
	const searchDirs = resolvePluginSearchDirectories();
	console.log(chalk.bold("\nPlugin search paths (precedence order):\n"));
	if (searchDirs.length === 0) {
		console.log(`  ${chalk.dim("(none)")}`);
	} else {
		for (const dir of searchDirs) {
			console.log(`  ${chalk.dim(dir)}`);
		}
	}

	console.log(chalk.bold("\nDiscovered plugins:\n"));
	if (discovered.length === 0) {
		console.log(chalk.dim("  No plugin binaries found."));
		console.log(
			chalk.dim(
				'  Install plugins with "toby plugins install <path>" or place binaries in ~/.toby/plugins/.',
			),
		);
		return;
	}

	for (const entry of discovered) {
		const inspected = inspectPluginBinary(entry);
		if ("error" in inspected) {
			console.log(
				`  ${chalk.red("✗")} ${chalk.bold(entry.binaryName)} ${chalk.dim(pluginDisplayPath(entry))}`,
			);
			console.log(`    ${chalk.red(inspected.error)} (${inspected.code})`);
			continue;
		}

		const metadata = getPluginMetadata(inspected.name) ?? inspected;
		console.log(
			`  ${chalk.green("✓")} ${chalk.bold(metadata.displayName)} ${chalk.dim(`(${metadata.name})`)}`,
		);
		console.log(`    ${chalk.dim(metadata.description)}`);
		console.log(
			`    ${chalk.dim(`v${metadata.version} · protocol ${metadata.protocolVersion} · ${pluginDisplayPath(entry)}`)}`,
		);
	}
	console.log();
}

async function runInstallPlugin(
	sourcePath: string,
	options: {
		force?: boolean;
		link?: boolean;
		setup?: boolean;
		noSetup?: boolean;
	},
): Promise<void> {
	if (options.setup && options.noSetup) {
		console.error(chalk.red("\nCannot use --setup and --no-setup together.\n"));
		process.exitCode = 1;
		return;
	}

	try {
		const result = installPlugin(sourcePath, options);
		const mode = result.linked ? "Linked" : "Installed";
		console.log(
			chalk.green(
				`\n${mode} ${result.displayName} v${result.version} (${result.name})`,
			),
		);
		console.log(chalk.dim(`  ${result.installPath}`));
		console.log(
			chalk.dim(`  Run "toby connect ${result.name}" to configure it.`),
		);

		if (result.setupAvailable) {
			const shouldRunSetup = await resolvePostInstallSetup(
				result,
				options.setup,
				options.noSetup,
			);
			if (shouldRunSetup) {
				await printPluginSetupResult(runPluginSetup(result.name));
			}
		}

		console.log();
	} catch (error) {
		if (error instanceof PluginInstallException) {
			console.error(chalk.red(`\n${error.message}\n`));
			process.exitCode = 1;
			return;
		}
		throw error;
	}
}

async function resolvePostInstallSetup(
	result: {
		name: string;
		displayName: string;
		setupDescription?: string;
	},
	requestSetup: boolean | undefined,
	skipSetup: boolean | undefined,
): Promise<boolean> {
	if (skipSetup) {
		return false;
	}

	if (requestSetup) {
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			throw new Error(
				"Plugin setup requires a TTY because it may need user interaction. Re-run in an interactive terminal.",
			);
		}
		return true;
	}

	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		console.log(
			chalk.dim(
				`  Setup available. Run "toby plugins setup ${result.name}" when ready.`,
			),
		);
		return false;
	}

	const description = result.setupDescription?.trim();
	const promptSuffix = description ? `\n  ${description}` : "";
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		const answer = await rl.question(
			chalk.yellow(
				`\nRun setup for ${result.displayName}? (y/N)${promptSuffix}\n> `,
			),
		);
		const normalized = answer.trim().toLowerCase();
		return normalized === "y" || normalized === "yes";
	} finally {
		rl.close();
	}
}

async function runPluginSetupCommand(name: string): Promise<void> {
	const discovered = discoverPluginBinaries().find(
		(entry) => entry.binaryName === `toby-plugin-${name}`,
	);
	if (!discovered) {
		console.error(chalk.red(`\nPlugin not found: ${name}\n`));
		process.exitCode = 1;
		return;
	}

	const inspected = inspectPluginBinary(discovered);
	if ("error" in inspected) {
		console.error(
			chalk.red(`\nFailed to inspect plugin: ${inspected.error}\n`),
		);
		process.exitCode = 1;
		return;
	}

	if (!inspected.setupAvailable) {
		console.error(chalk.red(`\nPlugin "${name}" does not advertise setup.\n`));
		process.exitCode = 1;
		return;
	}

	await printPluginSetupResult(runPluginSetup(name));
	console.log();
}

async function printPluginSetupResult(
	result: Awaited<ReturnType<typeof runPluginSetup>>,
): Promise<void> {
	if (!result.ok) {
		console.error(chalk.red(`\nSetup failed: ${result.error}\n`));
		process.exitCode = 1;
		return;
	}

	console.log(chalk.bold(`\nSetup: ${result.name}\n`));
	const actions = result.response.actions ?? [];
	if (actions.length === 0) {
		console.log(chalk.dim("  No setup actions reported."));
		return;
	}

	for (const line of formatPluginSetupActionLines(actions)) {
		const action = actions.find((entry) => line.startsWith(entry.label));
		if (!action) {
			console.log(`  ${line}`);
			continue;
		}
		const prefix = action.skipped
			? chalk.dim("○")
			: action.ok
				? chalk.green("✓")
				: chalk.red("✗");
		const detail = action.detail ? chalk.dim(` — ${action.detail}`) : "";
		console.log(`  ${prefix} ${action.label}${detail}`);
	}

	if (pluginSetupHasFailures(result.response)) {
		process.exitCode = 1;
	}
}

async function runUninstallPlugin(name: string): Promise<void> {
	try {
		const result = uninstallPlugin(name);
		console.log(chalk.green(`\nRemoved plugin "${result.name}"`));
		console.log(chalk.dim(`  ${result.removedPath}`));

		const cleaned: string[] = [];
		if (result.purged.credentials) cleaned.push("credentials");
		if (result.purged.connectionState) cleaned.push("connection state");
		if (result.purged.disabledEntry) cleaned.push("disabled entry");
		if (result.purged.defaultProviderReferences > 0) {
			cleaned.push(
				`${result.purged.defaultProviderReferences} default provider reference(s)`,
			);
		}
		if (result.purged.chatInboundReference)
			cleaned.push("chat inbound reference");
		if (result.purged.toolCacheEntries > 0) {
			cleaned.push(`${result.purged.toolCacheEntries} cached tool result(s)`);
		}

		if (cleaned.length > 0) {
			console.log(chalk.dim(`  Purged: ${cleaned.join(", ")}`));
		} else {
			console.log(chalk.dim("  No stored plugin configuration found."));
		}
		console.log();
	} catch (error) {
		if (error instanceof PluginInstallException) {
			console.error(chalk.red(`\n${error.message}\n`));
			process.exitCode = 1;
			return;
		}
		throw error;
	}
}

async function inspectPlugin(name: string): Promise<void> {
	const discovered = discoverPluginBinaries().find(
		(p) => p.binaryName === `toby-plugin-${name}`,
	);
	if (!discovered) {
		console.log(chalk.red(`Plugin not found: ${name}`));
		return;
	}

	const inspected = inspectPluginBinary(discovered);
	if ("error" in inspected) {
		console.log(chalk.red(`Failed to inspect plugin: ${inspected.error}`));
		console.log(chalk.dim(`Code: ${inspected.code}`));
		console.log(chalk.dim(`Name: ${inspected.binaryName}`));
		return;
	}

	console.log(chalk.bold(`\n${inspected.displayName}\n`));
	console.log(`  Name:       ${inspected.name}`);
	console.log(`  Version:    ${inspected.version}`);
	console.log(`  Protocol:   ${inspected.protocolVersion}`);
	console.log(`  Path:       ${targetDisplayPath(inspected.target)}`);
	console.log(
		`  Capabilities: ${(inspected.capabilities ?? []).join(", ") || "(none)"}`,
	);
	if (inspected.providerCategories?.length) {
		console.log(`  Categories: ${inspected.providerCategories.join(", ")}`);
	}
	console.log(`  ${chalk.dim(inspected.description)}`);
	if (inspected.setupAvailable) {
		const setupDetail = inspected.setupDescription
			? `: ${inspected.setupDescription}`
			: "";
		console.log(`  Setup:      available${setupDetail}`);
	}

	let tools: ReturnType<typeof pluginToolsList> | null;
	try {
		tools = pluginToolsList(resolvePluginTarget(discovered));
	} catch {
		tools = null;
	}
	if (tools?.ok && tools.data.ok && tools.data.tools?.length) {
		console.log(chalk.bold("\nTools:\n"));
		for (const tool of tools.data.tools) {
			const mode = tool.readOnly
				? chalk.green("read-only")
				: chalk.yellow("mutating");
			console.log(`  ${chalk.bold(tool.name)} ${chalk.dim(`[${mode}]`)}`);
			console.log(`    ${chalk.dim(tool.description)}`);
		}
	}
	console.log();
}

async function doctorPlugins(): Promise<void> {
	const discovered = discoverPluginBinaries();
	console.log(chalk.bold("\nPlugin doctor\n"));
	console.log(`  Protocol expected: ${CURRENT_PROTOCOL_VERSION}`);
	const searchDirs = resolvePluginSearchDirectories();
	console.log("  Search paths (precedence order):");
	for (const dir of searchDirs) {
		console.log(`    ${chalk.dim(dir)}`);
	}

	if (discovered.length === 0) {
		console.log(chalk.yellow("\n  No plugin binaries discovered."));
		return;
	}

	let failures = 0;
	for (const entry of discovered) {
		const validated = validatePluginBinary(entry);
		if (!validated.ok) {
			failures += 1;
			console.log(
				`\n  ${chalk.red("✗")} ${entry.binaryName}: ${validated.error} (${validated.code})`,
			);
			continue;
		}

		console.log(
			`\n  ${chalk.green("✓")} ${validated.metadata.displayName} v${validated.metadata.version} — validated`,
		);

		// Advisory: check standard tool compliance for dashboard categories
		const toolsResult = pluginToolsList(resolvePluginTarget(entry));
		if (toolsResult.ok && toolsResult.data.ok && toolsResult.data.tools) {
			const warnings = checkStandardToolCompliance(
				validated.metadata,
				toolsResult.data.tools,
			);
			for (const warning of warnings) {
				console.log(`    ${chalk.yellow("⚠")}  ${warning}`);
			}
		}
	}

	console.log();
	if (failures > 0) {
		console.log(chalk.red(`${failures} plugin(s) failed validation.`));
		process.exitCode = 1;
	} else {
		console.log(chalk.green("All discovered plugins passed validation."));
	}
}
