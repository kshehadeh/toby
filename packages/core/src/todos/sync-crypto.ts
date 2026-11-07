import { z } from "zod";
import {
	decryptBackupPayload,
	encryptBackupPayload,
} from "../config/backup-crypto";
import { todoOperationSchema } from "./operation";
import type { TodoOperation } from "./types";

export const TODO_BATCH_FORMAT = "toby.todos.operations.encrypted";
export const MAX_BATCH_BYTES = 2 * 1024 * 1024;
/** Each file costs one scrypt derivation, so batches stay large but bounded by bytes. */
export const MAX_BATCH_OPERATIONS = 2048;
const base64 = (bytes: number) =>
	z
		.string()
		.refine(
			(value) =>
				/^[A-Za-z0-9+/]*={0,2}$/.test(value) &&
				Buffer.from(value, "base64").length === bytes,
		);
const envelopeSchema = z
	.object({
		version: z.literal(1),
		format: z.literal(TODO_BATCH_FORMAT),
		encryption: z
			.object({
				cipher: z.literal("aes-256-gcm"),
				kdf: z.literal("scrypt"),
				n: z.literal(16384),
				r: z.literal(8),
				p: z.literal(1),
				keyLength: z.literal(32),
				salt: base64(16),
				iv: base64(12),
				authTag: base64(16),
			})
			.strict(),
		ciphertext: z.string().min(1).max(MAX_BATCH_BYTES),
	})
	.strict();
const payloadSchema = z
	.object({
		version: z.literal(1),
		format: z.literal("toby.todos.operations"),
		operations: z.array(todoOperationSchema).min(1).max(MAX_BATCH_OPERATIONS),
	})
	.strict();
export type EncryptedTodoBatch = z.infer<typeof envelopeSchema>;

export async function encryptTodoBatch(
	operations: TodoOperation[],
	password: string,
): Promise<EncryptedTodoBatch> {
	const payload = payloadSchema.parse({
		version: 1,
		format: "toby.todos.operations",
		operations,
	});
	const plaintext = JSON.stringify(payload);
	if (Buffer.byteLength(plaintext) > MAX_BATCH_BYTES / 2)
		throw new Error("Todo batch is too large.");
	const encrypted = await encryptBackupPayload(plaintext, password);
	return envelopeSchema.parse({
		version: 1,
		format: TODO_BATCH_FORMAT,
		encryption: encrypted.encryption,
		ciphertext: encrypted.ciphertext,
	});
}

export async function decryptTodoBatch(
	raw: string,
	password: string,
): Promise<TodoOperation[]> {
	if (Buffer.byteLength(raw) > MAX_BATCH_BYTES)
		throw new Error("Todo batch is too large.");
	// Fixed KDF parameters are checked before invoking scrypt on remote data.
	const envelope = envelopeSchema.parse(JSON.parse(raw));
	const plaintext = await decryptBackupPayload(
		{
			version: 2,
			format: "toby.config.backup.encrypted",
			createdAt: "",
			encryption: envelope.encryption,
			ciphertext: envelope.ciphertext,
		},
		password,
	);
	return payloadSchema.parse(JSON.parse(plaintext)).operations;
}
