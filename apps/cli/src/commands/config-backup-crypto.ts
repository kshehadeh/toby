/**
 * Re-export shared backup crypto from @toby/core so CLI and daemon use one
 * implementation. Prefer importing from `@toby/core/config/backup` in new code.
 */
export {
	decryptBackupPayload,
	encryptBackupPayload,
	isEncryptedBackupFile,
	type EncryptedBackupFile,
} from "@toby/core/config/backup";
