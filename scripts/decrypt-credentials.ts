#!/usr/bin/env bun
/**
 * Decrypt a Toby credentials.json for local debugging.
 *
 * Encrypted envelopes (macOS default) need the AES data key from Keychain
 * (service/account embedded in the envelope, usually
 * `dev.toby.credentials` / `data-encryption-key`).
 *
 * Usage:
 *   bun scripts/decrypt-credentials.ts
 *   bun scripts/decrypt-credentials.ts ~/.toby/credentials.json
 *   bun scripts/decrypt-credentials.ts ./credentials.json -o /tmp/creds.plain.json
 *   bun scripts/decrypt-credentials.ts ./credentials.json --compact
 *
 * Warnings:
 *   - Prints secrets to stdout (or the output file). Do not commit results.
 *   - Decrypting a file from another machine fails unless that machine's
 *     Keychain DEK is available (or you use a plaintext credentials file).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	CREDENTIALS_KEY_LENGTH,
	type EncryptedCredentialsEnvelope,
	decryptCredentialsPayload,
	isEncryptedCredentialsEnvelope,
} from "../packages/core/src/config/credentials-crypto";

function printUsage(): void {
	console.error(`Usage: bun scripts/decrypt-credentials.ts [path] [options]

Decrypt Toby credentials.json (encrypted envelope or plaintext) for debugging.

Arguments:
  path                 Credentials file (default: ~/.toby/credentials.json)

Options:
  -o, --output <path>  Write JSON to this file instead of stdout
  --compact            Print minified JSON
  -h, --help           Show this help

Examples:
  bun scripts/decrypt-credentials.ts
  bun scripts/decrypt-credentials.ts ~/.toby/credentials.json
  bun scripts/decrypt-credentials.ts ./credentials.json -o /tmp/creds.json
`);
}

function parseArgs(argv: string[]): {
	inputPath: string;
	outputPath?: string;
	compact: boolean;
	help: boolean;
} {
	let inputPath = path.join(os.homedir(), ".toby", "credentials.json");
	let outputPath: string | undefined;
	let compact = false;
	let help = false;
	let positionalUsed = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-h" || arg === "--help") {
			help = true;
			continue;
		}
		if (arg === "--compact") {
			compact = true;
			continue;
		}
		if (arg === "-o" || arg === "--output") {
			const next = argv[++i];
			if (!next) {
				throw new Error(`${arg} requires a path argument`);
			}
			outputPath = next;
			continue;
		}
		if (arg.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		}
		if (positionalUsed) {
			throw new Error(`Unexpected argument: ${arg}`);
		}
		inputPath = arg;
		positionalUsed = true;
	}

	return {
		inputPath: path.resolve(inputPath),
		outputPath: outputPath ? path.resolve(outputPath) : undefined,
		compact,
		help,
	};
}

function loadKeychainDataKey(service: string, account: string): Buffer {
	if (process.platform !== "darwin") {
		throw new Error(
			"Encrypted credentials require the macOS Keychain DEK. This host is not darwin.",
		);
	}
	const result = spawnSync(
		"security",
		["find-generic-password", "-a", account, "-s", service, "-w"],
		{ encoding: "utf-8" },
	);
	if (result.status !== 0) {
		const detail = (result.stderr ?? result.stdout ?? "").trim();
		throw new Error(
			`Could not read Keychain item service=${service} account=${account}${detail ? `: ${detail}` : "."}`,
		);
	}
	const password = (result.stdout ?? "").trim();
	if (!password) {
		throw new Error(
			`Keychain item service=${service} account=${account} is empty.`,
		);
	}
	const key = Buffer.from(password, "base64");
	if (key.length !== CREDENTIALS_KEY_LENGTH) {
		throw new Error(
			`Keychain DEK has unexpected length ${key.length} (expected ${CREDENTIALS_KEY_LENGTH}).`,
		);
	}
	return key;
}

function decryptFile(filePath: string): {
	plaintext: string;
	source: "encrypted" | "plaintext";
	keychainService?: string;
	keychainAccount?: string;
} {
	if (!fs.existsSync(filePath)) {
		throw new Error(`File not found: ${filePath}`);
	}
	const raw = fs.readFileSync(filePath, "utf-8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in ${filePath}: ${msg}`);
	}

	if (isEncryptedCredentialsEnvelope(parsed)) {
		const envelope = parsed as EncryptedCredentialsEnvelope;
		const service = envelope.encryption.keychainService;
		const account = envelope.encryption.keychainAccount;
		const dataKey = loadKeychainDataKey(service, account);
		const plaintext = decryptCredentialsPayload(envelope, dataKey);
		// Validate JSON shape before printing.
		JSON.parse(plaintext);
		return {
			plaintext,
			source: "encrypted",
			keychainService: service,
			keychainAccount: account,
		};
	}

	// Already plaintext CredentialsFile
	JSON.parse(JSON.stringify(parsed));
	return {
		plaintext: JSON.stringify(parsed, null, 2),
		source: "plaintext",
	};
}

function main(): void {
	let args: ReturnType<typeof parseArgs>;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		printUsage();
		process.exit(2);
	}

	if (args.help) {
		printUsage();
		process.exit(0);
	}

	try {
		const result = decryptFile(args.inputPath);
		const parsed = JSON.parse(result.plaintext) as unknown;
		const out = args.compact
			? JSON.stringify(parsed)
			: `${JSON.stringify(parsed, null, 2)}\n`;

		// Metadata on stderr so stdout stays pure JSON for piping.
		console.error(
			`# decrypted ${args.inputPath} (${result.source}${
				result.keychainService
					? `; keychain ${result.keychainService}/${result.keychainAccount}`
					: ""
			})`,
		);

		if (args.outputPath) {
			fs.writeFileSync(args.outputPath, out, { mode: 0o600 });
			console.error(`# wrote ${args.outputPath} (mode 0600)`);
		} else {
			process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

main();
