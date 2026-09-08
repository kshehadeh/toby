import {
	type CipherGCM,
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	scryptSync,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * File-backed encrypted backup container.
 *
 * Layout:
 *   line 1: "TOBYBACKUP\t<formatVersion>\t<16-digit header offset>\n"
 *   binary: section ciphertexts (offsets relative to end of line 1)
 *   tail:   JSON header + "\n" at the recorded offset
 *
 * The header (section offsets, IVs, auth tags, scrypt params) is plaintext so
 * archives can be listed without the password; all section payloads are
 * AES-256-GCM encrypted with a scrypt key derived from the password. Large
 * sections (audio, project files) are streamed in both directions so backups
 * of multi-hundred-megabyte recording libraries do not need to fit in memory.
 */

const MAGIC = "TOBYBACKUP";
const FORMAT_VERSION = "1";
const OFFSET_DIGITS = 16;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const READ_CHUNK_BYTES = 1024 * 1024;

export interface BackupArchiveKdf {
	readonly kdf: "scrypt";
	readonly n: number;
	readonly r: number;
	readonly p: number;
	readonly keyLength: number;
	readonly salt: string;
}

export interface BackupArchiveSectionInfo {
	/** Ciphertext offset relative to the start of the section data region. */
	readonly offset: number;
	/** Ciphertext length in bytes. */
	readonly length: number;
	readonly iv: string;
	readonly authTag: string;
}

export interface BackupArchiveHeader {
	readonly format: "toby.backup.archive";
	readonly version: 1;
	readonly createdAt: string;
	readonly kdf: BackupArchiveKdf;
	readonly sections: Record<string, BackupArchiveSectionInfo>;
	/** Non-secret metadata (device name for daily snapshots, etc.). */
	readonly info?: Record<string, string>;
}

function prefixBuffer(headerOffset: number): Buffer {
	const line = `${MAGIC}\t${FORMAT_VERSION}\t${String(headerOffset).padStart(
		OFFSET_DIGITS,
		"0",
	)}\n`;
	return Buffer.from(line, "utf8");
}

const PREFIX_LENGTH = prefixBuffer(0).length;

function decryptError(): Error {
	return new Error(
		"Could not decrypt backup. Check that the password is correct and the file is valid.",
	);
}

/** Cheap check for the archive magic so callers can branch legacy JSON vs archive. */
export function isBackupArchiveFile(filePath: string): boolean {
	let fd: number | undefined;
	try {
		fd = fs.openSync(filePath, "r");
		const head = Buffer.alloc(MAGIC.length + 1);
		const read = fs.readSync(fd, head, 0, head.length, 0);
		return read === head.length && head.toString("utf8") === `${MAGIC}\t`;
	} catch {
		return false;
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
}

function isBackupArchiveHeader(value: unknown): value is BackupArchiveHeader {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	if (
		record.format !== "toby.backup.archive" ||
		record.version !== 1 ||
		typeof record.createdAt !== "string" ||
		typeof record.kdf !== "object" ||
		record.kdf === null ||
		typeof record.sections !== "object" ||
		record.sections === null
	) {
		return false;
	}
	const kdf = record.kdf as Record<string, unknown>;
	return (
		kdf.kdf === "scrypt" &&
		typeof kdf.n === "number" &&
		typeof kdf.r === "number" &&
		typeof kdf.p === "number" &&
		typeof kdf.keyLength === "number" &&
		typeof kdf.salt === "string"
	);
}

/** Parse the plaintext header without needing the password. */
export function readBackupArchiveHeader(filePath: string): BackupArchiveHeader {
	const fd = fs.openSync(filePath, "r");
	try {
		const prefix = Buffer.alloc(PREFIX_LENGTH);
		fs.readSync(fd, prefix, 0, PREFIX_LENGTH, 0);
		const parts = prefix.toString("utf8").split("\t");
		if (
			parts.length !== 3 ||
			parts[0] !== MAGIC ||
			parts[1] !== FORMAT_VERSION
		) {
			throw new Error("Not a valid Toby backup archive.");
		}
		const headerOffset = Number.parseInt(parts[2], 10);
		const fileSize = fs.fstatSync(fd).size;
		if (
			!Number.isSafeInteger(headerOffset) ||
			headerOffset <= PREFIX_LENGTH ||
			headerOffset >= fileSize
		) {
			throw new Error("Backup archive header is invalid.");
		}
		const headerBytes = Buffer.alloc(fileSize - headerOffset);
		fs.readSync(fd, headerBytes, 0, headerBytes.length, headerOffset);
		const header: unknown = JSON.parse(headerBytes.toString("utf8"));
		if (!isBackupArchiveHeader(header)) {
			throw new Error("Backup archive header is invalid.");
		}
		return header;
	} finally {
		fs.closeSync(fd);
	}
}

export class BackupArchiveWriter {
	private readonly fd: number;
	private readonly key: Buffer;
	private readonly salt: Buffer;
	private readonly sections: Record<string, BackupArchiveSectionInfo> = {};
	private cipher: CipherGCM | null = null;
	private sectionName: string | null = null;
	private sectionIv: Buffer = Buffer.alloc(0);
	private sectionOffset = 0;
	private sectionBytes = 0;
	private dataBytes = 0;
	private finished = false;

	constructor(
		private readonly outputPath: string,
		password: string,
	) {
		const trimmed = password.trim();
		if (!trimmed) {
			throw new Error("Backup password cannot be empty.");
		}
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		this.fd = fs.openSync(outputPath, "w");
		this.salt = randomBytes(SALT_LENGTH);
		this.key = scryptSync(trimmed, this.salt, KEY_LENGTH, {
			N: SCRYPT_N,
			r: SCRYPT_R,
			p: SCRYPT_P,
		}) as Buffer;
		// Placeholder prefix; rewritten with the real header offset in finish().
		fs.writeSync(this.fd, prefixBuffer(0));
	}

	/** Write a small section from a single buffer. */
	async writeSection(name: string, data: Uint8Array): Promise<void> {
		this.beginSection(name);
		this.appendBufferToSection(data);
		await this.endSection();
	}

	beginSection(name: string): void {
		if (this.finished) throw new Error("Archive is already finished.");
		if (this.sectionName) {
			throw new Error(`Section "${this.sectionName}" is still open.`);
		}
		if (this.sections[name]) {
			throw new Error(`Duplicate archive section: ${name}`);
		}
		this.sectionName = name;
		this.sectionOffset = this.dataBytes;
		this.sectionBytes = 0;
		this.sectionIv = randomBytes(IV_LENGTH);
		this.cipher = createCipheriv("aes-256-gcm", this.key, this.sectionIv);
	}

	appendBufferToSection(data: Uint8Array): void {
		const cipher = this.requireOpenSection();
		const out = cipher.update(data);
		if (out.length > 0) fs.writeSync(this.fd, out);
		this.sectionBytes += out.length;
		this.dataBytes += out.length;
	}

	/** Stream a file into the open section. Returns size + sha256 of the file. */
	async appendFileToSection(filePath: string): Promise<{
		size: number;
		sha256: string;
	}> {
		this.requireOpenSection();
		const hash = createHash("sha256");
		const stream = Bun.file(filePath).stream();
		let size = 0;
		for await (const chunk of stream) {
			const buf = Buffer.from(chunk);
			hash.update(buf);
			this.appendBufferToSection(buf);
			size += buf.length;
		}
		return { size, sha256: hash.digest("hex") };
	}

	async endSection(): Promise<void> {
		const cipher = this.requireOpenSection();
		const name = this.sectionName as string;
		const tail = cipher.final();
		if (tail.length > 0) fs.writeSync(this.fd, tail);
		this.sections[name] = {
			offset: this.sectionOffset,
			length: this.sectionBytes + tail.length,
			iv: this.sectionIv.toString("base64"),
			authTag: cipher.getAuthTag().toString("base64"),
		};
		this.dataBytes += tail.length;
		this.cipher = null;
		this.sectionName = null;
	}

	/** Seal the archive: rewrite the prefix and append the JSON header. */
	async finish(info?: Record<string, string>): Promise<BackupArchiveHeader> {
		if (this.sectionName) {
			throw new Error(`Section "${this.sectionName}" is still open.`);
		}
		if (this.finished) throw new Error("Archive is already finished.");
		this.finished = true;
		const header: BackupArchiveHeader = {
			format: "toby.backup.archive",
			version: 1,
			createdAt: new Date().toISOString(),
			kdf: {
				kdf: "scrypt",
				n: SCRYPT_N,
				r: SCRYPT_R,
				p: SCRYPT_P,
				keyLength: KEY_LENGTH,
				salt: this.salt.toString("base64"),
			},
			sections: this.sections,
			...(info ? { info } : {}),
		};
		const headerOffset = PREFIX_LENGTH + this.dataBytes;
		const prefix = prefixBuffer(headerOffset);
		if (prefix.length !== PREFIX_LENGTH) {
			throw new Error("Archive prefix length mismatch.");
		}
		fs.writeSync(this.fd, prefix, 0, prefix.length, 0);
		fs.writeSync(this.fd, Buffer.from(`${JSON.stringify(header)}\n`, "utf8"));
		fs.closeSync(this.fd);
		return header;
	}

	private requireOpenSection(): CipherGCM {
		if (!this.cipher || !this.sectionName) {
			throw new Error("No archive section is open.");
		}
		return this.cipher;
	}
}

export class BackupArchiveReader {
	private readonly fd: number;
	private readonly header: BackupArchiveHeader;
	private readonly key: Buffer;

	constructor(filePath: string, password: string) {
		this.header = readBackupArchiveHeader(filePath);
		const trimmed = password.trim();
		if (!trimmed) {
			throw new Error("This backup is encrypted. Enter the backup password.");
		}
		this.fd = fs.openSync(filePath, "r");
		this.key = scryptSync(
			trimmed,
			Buffer.from(this.header.kdf.salt, "base64"),
			this.header.kdf.keyLength,
			{ N: this.header.kdf.n, r: this.header.kdf.r, p: this.header.kdf.p },
		) as Buffer;
	}

	hasSection(name: string): boolean {
		return this.header.sections[name] !== undefined;
	}

	/** Decrypt a section fully into memory (small sections only). */
	async readSection(name: string): Promise<Buffer> {
		const parts: Buffer[] = [];
		for await (const chunk of this.sectionChunks(name)) {
			parts.push(chunk);
		}
		return Buffer.concat(parts);
	}

	/** Stream-decrypt a section, yielding plaintext chunks. */
	async *sectionChunks(name: string): AsyncGenerator<Buffer, void, unknown> {
		const info = this.header.sections[name];
		if (!info) {
			throw new Error(`Backup archive has no "${name}" section.`);
		}
		const decipher = createDecipheriv(
			"aes-256-gcm",
			this.key,
			Buffer.from(info.iv, "base64"),
		);
		decipher.setAuthTag(Buffer.from(info.authTag, "base64"));
		let remaining = info.length;
		let position = PREFIX_LENGTH + info.offset;
		while (remaining > 0) {
			const len = Math.min(READ_CHUNK_BYTES, remaining);
			const buf = Buffer.alloc(len);
			let filled = 0;
			while (filled < len) {
				const read = fs.readSync(
					this.fd,
					buf,
					filled,
					len - filled,
					position + filled,
				);
				if (read <= 0) throw decryptError();
				filled += read;
			}
			const out = decipher.update(buf);
			if (out.length > 0) yield out;
			position += len;
			remaining -= len;
		}
		let tail: Buffer;
		try {
			tail = decipher.final();
		} catch {
			// Wrong password or corrupted ciphertext fails GCM authentication.
			throw decryptError();
		}
		if (tail.length > 0) yield tail;
	}

	close(): void {
		fs.closeSync(this.fd);
	}
}
