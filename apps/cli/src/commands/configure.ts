import { readFileSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import {
	buildBackupFileName,
	createEncryptedConfigBackup,
	isEncryptedBackupFile,
	parseRestorePayload,
	restoreConfigBackup,
} from "@toby/core/config/backup";
import { getConfigPath, getCredentialsPath } from "@toby/core/config/index";
import {
	disableSync,
	enableSync,
	getSyncStatus,
	listSyncHistory,
	pullSnapshot,
	pushSnapshot,
	restoreSyncHistory,
} from "@toby/core/config/sync";
import chalk from "chalk";
import type { Command } from "commander";
import { runAppLaunchCommand } from "./app";

interface BackupCommandOptions {
	output?: string;
}

interface RestoreCommandOptions {
	yes?: boolean;
}

export function registerConfigCommand(program: Command): void {
	const config = program
		.command("config")
		.description(
			"Open native app settings and manage config backup, restore, and iCloud sync",
		);

	config.action(() => {
		runAppLaunchCommand("Settings");
	});

	config
		.command("backup")
		.description("Back up config.json and credentials.json to a file")
		.option(
			"-o, --output <path>",
			"Backup destination file or directory (defaults to current directory)",
		)
		.action(async (options: BackupCommandOptions) => {
			try {
				await backupConfig(options.output);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(message));
				process.exitCode = 1;
			}
		});

	config
		.command("restore")
		.description("Restore config.json and credentials.json from a backup file")
		.argument("<sourceFile>", "Path to a backup file created by config backup")
		.option(
			"-y, --yes",
			"Skip confirmation when existing config files will be replaced",
		)
		.action(async (sourceFile: string, options: RestoreCommandOptions) => {
			try {
				await restoreConfig(sourceFile, options.yes === true);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(message));
				process.exitCode = 1;
			}
		});

	const sync = config
		.command("sync")
		.description("Sync settings and credentials through iCloud Drive");

	sync
		.command("status")
		.description("Show iCloud settings sync status")
		.action(async () => {
			try {
				await printSyncStatus();
			} catch (error) {
				failCli(error);
			}
		});

	sync
		.command("enable")
		.description("Enable iCloud settings sync")
		.option(
			"--mode <mode>",
			"create, join, or replace (default: join if a vault exists, else create)",
		)
		.action(async (options: { mode?: string }) => {
			try {
				const mode = parseSyncMode(options.mode);
				const password = await promptForSyncPassword(true);
				await enableSync({ password, mode });
				console.log(chalk.green("iCloud settings sync enabled."));
				await printSyncStatus();
			} catch (error) {
				failCli(error);
			}
		});

	sync
		.command("disable")
		.description("Disable iCloud settings sync")
		.option("--delete-cloud", "Also delete the iCloud vault and history")
		.action(async (options: { deleteCloud?: boolean }) => {
			try {
				await disableSync({ deleteCloud: options.deleteCloud === true });
				console.log(chalk.green("iCloud settings sync disabled."));
			} catch (error) {
				failCli(error);
			}
		});

	sync
		.command("push")
		.description("Upload a settings snapshot to iCloud now")
		.action(async () => {
			try {
				const result = await pushSnapshot({ force: true });
				if (result.pushed) {
					console.log(chalk.green("Pushed settings snapshot to iCloud."));
				} else {
					console.log(
						chalk.dim(`Did not push (${result.reason ?? "skipped"}).`),
					);
				}
			} catch (error) {
				failCli(error);
			}
		});

	sync
		.command("pull")
		.description("Download and apply the iCloud settings snapshot")
		.option("-y, --yes", "Confirm replacing local settings from iCloud")
		.action(async (options: { yes?: boolean }) => {
			try {
				if (!options.yes) {
					const confirmed = await confirmYes(
						"Replace local settings from the iCloud vault? [y/N] ",
					);
					if (!confirmed) {
						console.log(chalk.yellow("Pull cancelled."));
						return;
					}
				}
				const result = await pullSnapshot({ confirm: true });
				if (result.applied) {
					console.log(chalk.green("Applied iCloud settings snapshot."));
				} else {
					console.log(
						chalk.dim(`Did not apply (${result.reason ?? "skipped"}).`),
					);
				}
			} catch (error) {
				failCli(error);
			}
		});

	sync
		.command("history")
		.description("List previous iCloud settings snapshots")
		.action(async () => {
			try {
				const history = await listSyncHistory();
				if (history.length === 0) {
					console.log(chalk.dim("No history snapshots."));
					return;
				}
				for (const item of history) {
					console.log(
						`${item.filename}  lamport=${item.clock.lamport}  ${item.clock.deviceName}  ${item.createdAt}`,
					);
				}
			} catch (error) {
				failCli(error);
			}
		});

	sync
		.command("restore-history")
		.description("Restore a previous iCloud snapshot and push it as current")
		.argument("<filename>", "History filename from `toby config sync history`")
		.option("-y, --yes", "Confirm restoring that snapshot")
		.action(async (filename: string, options: { yes?: boolean }) => {
			try {
				if (!options.yes) {
					const confirmed = await confirmYes(
						`Restore ${filename} and upload it as the current vault? [y/N] `,
					);
					if (!confirmed) {
						console.log(chalk.yellow("Restore cancelled."));
						return;
					}
				}
				await restoreSyncHistory({ filename, confirm: true });
				console.log(chalk.green(`Restored ${filename} and pushed to iCloud.`));
			} catch (error) {
				failCli(error);
			}
		});

	program
		.command("configure", { hidden: true })
		.description("Deprecated alias for `config`")
		.action(() => {
			console.log(
				chalk.yellow("`configure` is deprecated. Use `config` instead."),
			);
			runAppLaunchCommand("Settings");
		});
}

async function backupConfig(outputPath?: string): Promise<void> {
	const backupPath = await resolveBackupPath(outputPath);
	const password = await promptForBackupPassword();
	const { backup } = await createEncryptedConfigBackup(password);

	await mkdir(path.dirname(backupPath), { recursive: true });
	await writeFile(backupPath, JSON.stringify(backup, null, 2), "utf-8");
	console.log(chalk.green(`Backup saved to ${backupPath}`));
}

async function restoreConfig(
	sourceFile: string,
	skipConfirmation: boolean,
): Promise<void> {
	const sourcePath = path.resolve(sourceFile);
	const rawBackup = readFileSync(sourcePath, "utf-8");
	const parsedJson = safeParseJson(rawBackup, sourcePath);

	let password: string | undefined;
	if (isEncryptedBackupFile(parsedJson)) {
		password = await promptForRestorePassword();
	} else {
		// Validate shape early for clearer errors (legacy unencrypted).
		await parseRestorePayload(parsedJson);
	}

	const configExists = await fileExists(getConfigPath());
	const credentialsExists = await fileExists(getCredentialsPath());

	if ((configExists || credentialsExists) && !skipConfirmation) {
		const confirmed = await confirmConfigReplace(
			configExists,
			credentialsExists,
		);
		if (!confirmed) {
			console.log(chalk.yellow("Restore cancelled."));
			return;
		}
	}

	await restoreConfigBackup(parsedJson, password);
	console.log(chalk.green(`Config restored from ${sourcePath}`));
}

function safeParseJson(raw: string, sourcePath: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error(`Backup at ${sourcePath} is not valid JSON.`);
	}
}

async function resolveBackupPath(outputPath?: string): Promise<string> {
	const output = outputPath?.trim();
	if (!output) {
		return path.resolve(process.cwd(), buildBackupFileName());
	}

	const resolvedOutput = path.resolve(output);
	const outputStats = await safeStat(resolvedOutput);
	if (outputStats?.isDirectory()) {
		return path.join(resolvedOutput, buildBackupFileName());
	}

	return resolvedOutput;
}

async function safeStat(targetPath: string) {
	try {
		return await stat(targetPath);
	} catch {
		return null;
	}
}

async function fileExists(targetPath: string): Promise<boolean> {
	return (await safeStat(targetPath)) !== null;
}

async function confirmConfigReplace(
	configExists: boolean,
	credentialsExists: boolean,
): Promise<boolean> {
	const existingFiles: string[] = [];
	if (configExists) {
		existingFiles.push("config.json");
	}
	if (credentialsExists) {
		existingFiles.push("credentials.json");
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const answer = await rl.question(
			`Replace existing ${existingFiles.join(" and ")}? [y/N] `,
		);
		return answer.trim().toLowerCase() === "y";
	} finally {
		rl.close();
	}
}

async function promptForBackupPassword(): Promise<string> {
	const password = await promptHiddenInput("Enter backup password: ");
	if (!password) {
		throw new Error("Backup password cannot be empty.");
	}
	const confirmation = await promptHiddenInput("Confirm backup password: ");
	if (password !== confirmation) {
		throw new Error("Backup passwords do not match.");
	}
	return password;
}

async function promptForRestorePassword(): Promise<string> {
	const password = await promptHiddenInput("Enter backup password: ");
	if (!password) {
		throw new Error("Backup password cannot be empty.");
	}
	return password;
}

function failCli(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	console.error(chalk.red(message));
	process.exitCode = 1;
}

function parseSyncMode(
	value: string | undefined,
): "create" | "join" | "replace" | undefined {
	if (!value) return undefined;
	if (value === "create" || value === "join" || value === "replace") {
		return value;
	}
	throw new Error("mode must be create, join, or replace.");
}

async function printSyncStatus(): Promise<void> {
	const status = await getSyncStatus();
	console.log(`enabled: ${status.enabled ? "yes" : "no"}`);
	console.log(
		`iCloud Drive: ${status.iCloudAvailable ? "available" : "not found"}`,
	);
	console.log(`device: ${status.deviceName} (${status.deviceId})`);
	console.log(`vault: ${status.vaultPath}`);
	if (status.lastPushAt) console.log(`last push: ${status.lastPushAt}`);
	if (status.lastPullAt) console.log(`last pull: ${status.lastPullAt}`);
	if (status.lastWriterDeviceName) {
		console.log(
			`last writer: ${status.lastWriterDeviceName} (lamport ${status.lastAckedLamport})`,
		);
	}
	if (status.lastError) {
		console.log(chalk.red(`error: ${status.lastError}`));
	}
}

async function promptForSyncPassword(confirm: boolean): Promise<string> {
	const password = await promptHiddenInput("Enter iCloud sync password: ");
	if (!password) {
		throw new Error("Sync password cannot be empty.");
	}
	if (confirm) {
		const confirmation = await promptHiddenInput(
			"Confirm iCloud sync password: ",
		);
		if (password !== confirmation) {
			throw new Error("Sync passwords do not match.");
		}
	}
	return password;
}

async function confirmYes(prompt: string): Promise<boolean> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const answer = await rl.question(prompt);
		return answer.trim().toLowerCase() === "y";
	} finally {
		rl.close();
	}
}

async function promptHiddenInput(prompt: string): Promise<string> {
	const stdin = process.stdin;
	const stdout = process.stdout;
	if (!stdin.isTTY || !stdout.isTTY) {
		const rl = readline.createInterface({ input: stdin, output: stdout });
		try {
			return (await rl.question(prompt)).trim();
		} finally {
			rl.close();
		}
	}

	return await new Promise<string>((resolve, reject) => {
		stdout.write(prompt);
		const wasRaw = stdin.isRaw;
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");

		let value = "";
		const onData = (chunk: string) => {
			for (const char of chunk) {
				if (char === "\n" || char === "\r" || char === "\u0004") {
					cleanup();
					stdout.write("\n");
					resolve(value);
					return;
				}
				if (char === "\u0003") {
					cleanup();
					stdout.write("\n");
					reject(new Error("Cancelled."));
					return;
				}
				if (char === "\u007f" || char === "\b") {
					if (value.length > 0) {
						value = value.slice(0, -1);
					}
					continue;
				}
				value += char;
			}
		};

		const cleanup = () => {
			stdin.off("data", onData);
			stdin.setRawMode(wasRaw);
			stdin.pause();
		};

		stdin.on("data", onData);
	});
}
