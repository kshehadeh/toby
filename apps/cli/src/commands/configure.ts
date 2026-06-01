import { readFileSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import chalk from "chalk";
import type { Command } from "commander";
import {
	getConfigPath,
	getCredentialsPath,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "../config/index";
import { runConfigureUI } from "../ui/configure/App";
import { createConfigureSession } from "../ui/configure/session";
import {
	decryptBackupPayload,
	encryptBackupPayload,
	isEncryptedBackupFile,
} from "./config-backup-crypto";

interface ConfigBackupPayload {
	version: 1;
	createdAt: string;
	config: ReturnType<typeof readConfig>;
	credentials: ReturnType<typeof readCredentials>;
}

interface BackupCommandOptions {
	output?: string;
}

interface RestoreCommandOptions {
	yes?: boolean;
}

export function registerConfigCommand(program: Command): void {
	const config = program
		.command("config")
		.description("Configure Toby settings and manage config backups");

	config.action(() => {
		runConfigureSession();
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

	program
		.command("configure", { hidden: true })
		.description("Deprecated alias for `config`")
		.action(() => {
			console.log(
				chalk.yellow("`configure` is deprecated. Use `config` instead."),
			);
			runConfigureSession();
		});
}

function runConfigureSession(): void {
	const session = createConfigureSession();

	runConfigureUI(
		session.initialTree,
		session.initialValues,
		session.onSave,
		session.refreshTree,
		session.callbacks,
	);
}

async function backupConfig(outputPath?: string): Promise<void> {
	const backupPath = await resolveBackupPath(outputPath);
	const password = await promptForBackupPassword();
	const payload: ConfigBackupPayload = {
		version: 1,
		createdAt: new Date().toISOString(),
		config: readConfig(),
		credentials: readCredentials(),
	};
	const encryptedBackup = await encryptBackupPayload(
		JSON.stringify(payload),
		password,
	);

	await mkdir(path.dirname(backupPath), { recursive: true });
	await writeFile(
		backupPath,
		JSON.stringify(encryptedBackup, null, 2),
		"utf-8",
	);
	console.log(chalk.green(`Backup saved to ${backupPath}`));
}

async function restoreConfig(
	sourceFile: string,
	skipConfirmation: boolean,
): Promise<void> {
	const sourcePath = path.resolve(sourceFile);
	const rawBackup = readFileSync(sourcePath, "utf-8");
	const payload = await parseRestorePayload(rawBackup, sourcePath);
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

	writeConfig(payload.config);
	writeCredentials(payload.credentials);
	console.log(chalk.green(`Config restored from ${sourcePath}`));
}

async function parseRestorePayload(
	raw: string,
	sourcePath: string,
): Promise<ConfigBackupPayload> {
	const parsedJson = safeParseJson(raw, sourcePath);
	if (isEncryptedBackupFile(parsedJson)) {
		const password = await promptForRestorePassword();
		const decrypted = await decryptBackupPayload(parsedJson, password);
		return parseBackupPayload(decrypted, sourcePath);
	}

	return parseBackupPayload(raw, sourcePath);
}

function safeParseJson(raw: string, sourcePath: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error(`Backup at ${sourcePath} is not valid JSON.`);
	}
}

function parseBackupPayload(
	raw: string,
	sourcePath: string,
): ConfigBackupPayload {
	const parsed = safeParseJson(raw, sourcePath);

	if (!isConfigBackupPayload(parsed)) {
		throw new Error(
			`Backup at ${sourcePath} is not a valid Toby config backup.`,
		);
	}

	return parsed;
}

function isConfigBackupPayload(value: unknown): value is ConfigBackupPayload {
	if (!isRecord(value)) {
		return false;
	}

	return (
		value.version === 1 &&
		typeof value.createdAt === "string" &&
		isRecord(value.config) &&
		isRecord(value.credentials)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function buildBackupFileName(): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `toby-config-backup-${timestamp}.tbybak`;
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
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error(
			[
				"Existing config files were found and confirmation is required.",
				"Re-run with --yes to skip the prompt in non-interactive mode.",
			].join(" "),
		);
	}

	const existingFiles = [];
	if (configExists) {
		existingFiles.push("config.json");
	}
	if (credentialsExists) {
		existingFiles.push("credentials.json");
	}
	const existingFilesLabel = existingFiles.join(" and ");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		const answer = await rl.question(
			chalk.yellow(
				`This will replace existing ${existingFilesLabel}. Continue? (y/N) `,
			),
		);
		const normalized = answer.trim().toLowerCase();
		return normalized === "y" || normalized === "yes";
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
		throw new Error("Passwords did not match.");
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

async function promptHiddenInput(prompt: string): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error(
			"Password input requires an interactive terminal. Run this command in a TTY session.",
		);
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});

	try {
		const answer = await rl.question(`${prompt} `);
		return answer.trim();
	} finally {
		rl.close();
	}
}
