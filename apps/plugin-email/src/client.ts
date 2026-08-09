import { log } from "./log";

type JsonRecord = Record<string, unknown>;

export interface EmailConfig {
	imapHost: string;
	imapPort: number;
	imapSecure: boolean;
	imapUsername: string;
	imapPassword: string;
	smtpHost: string;
	smtpPort: number;
	smtpSecure: boolean;
	smtpUsername: string;
	smtpPassword: string;
	fromAddress: string;
	fromName: string;
}

export interface ImapConnectionOptions {
	host: string;
	port: number;
	secure: boolean;
	doSTARTTLS?: boolean;
	auth: {
		user: string;
		pass: string;
	};
	logger: false;
	connectionTimeout: number;
	greetingTimeout: number;
	socketTimeout: number;
}

const IMAP_STARTTLS_PORT = 143;
const IMAP_CONNECTION_TIMEOUT_MS = 15_000;
const IMAP_GREETING_TIMEOUT_MS = 10_000;
const IMAP_SOCKET_TIMEOUT_MS = 60_000;

function parseBoolean(raw: unknown, defaultValue: boolean): boolean {
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "string") {
		const lower = raw.trim().toLowerCase();
		if (lower === "true" || lower === "1" || lower === "yes") return true;
		if (lower === "false" || lower === "0" || lower === "no") return false;
	}
	if (typeof raw === "number") return raw !== 0;
	return defaultValue;
}

function parsePort(raw: unknown, defaultValue: number): number {
	const num = Number(raw);
	return Number.isFinite(num) && num > 0 ? Math.floor(num) : defaultValue;
}

export function parseEmailConfig(raw: JsonRecord): EmailConfig {
	return {
		imapHost: String(raw.imapHost ?? "").trim(),
		imapPort: parsePort(raw.imapPort, 993),
		imapSecure: parseBoolean(raw.imapSecure, true),
		imapUsername: String(raw.imapUsername ?? "").trim(),
		imapPassword: String(raw.imapPassword ?? "").trim(),
		smtpHost: String(raw.smtpHost ?? "").trim(),
		smtpPort: parsePort(raw.smtpPort, 587),
		smtpSecure: parseBoolean(raw.smtpSecure, false),
		smtpUsername: String(raw.smtpUsername ?? "").trim(),
		smtpPassword: String(raw.smtpPassword ?? "").trim(),
		fromAddress: String(raw.fromAddress ?? "").trim(),
		fromName: String(raw.fromName ?? "").trim(),
	};
}

export function hasImapCredentials(config: JsonRecord): boolean {
	const parsed = parseEmailConfig(config);
	return Boolean(parsed.imapHost && parsed.imapUsername && parsed.imapPassword);
}

export function hasSmtpCredentials(config: JsonRecord): boolean {
	const parsed = parseEmailConfig(config);
	return Boolean(parsed.smtpHost && parsed.smtpUsername && parsed.smtpPassword);
}

export function hasCredentials(config: JsonRecord): boolean {
	return hasImapCredentials(config);
}

export function normalizeConfig(raw: JsonRecord): JsonRecord {
	const parsed = parseEmailConfig(raw);
	return {
		imapHost: parsed.imapHost,
		imapPort: String(parsed.imapPort),
		imapSecure: String(parsed.imapSecure),
		imapUsername: parsed.imapUsername,
		imapPassword: parsed.imapPassword,
		smtpHost: parsed.smtpHost,
		smtpPort: String(parsed.smtpPort),
		smtpSecure: String(parsed.smtpSecure),
		smtpUsername: parsed.smtpUsername,
		smtpPassword: parsed.smtpPassword,
		fromAddress: parsed.fromAddress,
		fromName: parsed.fromName,
	};
}

export function buildImapConnectionOptions(
	config: JsonRecord,
): ImapConnectionOptions {
	const parsed = parseEmailConfig(config);
	const useDirectTls =
		parsed.imapSecure && parsed.imapPort !== IMAP_STARTTLS_PORT;
	const useRequiredStartTls =
		parsed.imapSecure && parsed.imapPort === IMAP_STARTTLS_PORT;

	return {
		host: parsed.imapHost,
		port: parsed.imapPort,
		secure: useDirectTls,
		...(useRequiredStartTls ? { doSTARTTLS: true } : {}),
		...(!parsed.imapSecure ? { doSTARTTLS: false } : {}),
		auth: {
			user: parsed.imapUsername,
			pass: parsed.imapPassword,
		},
		logger: false,
		connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
		greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
		socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
	};
}

export function sanitizeImapConnectionOptions(
	options: ImapConnectionOptions,
): JsonRecord {
	return {
		host: options.host,
		port: options.port,
		secure: options.secure,
		doSTARTTLS: options.doSTARTTLS ?? null,
		username: options.auth.user,
		passwordConfigured: Boolean(options.auth.pass),
		logger: options.logger,
		connectionTimeout: options.connectionTimeout,
		greetingTimeout: options.greetingTimeout,
		socketTimeout: options.socketTimeout,
	};
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function createConnectedImapClient(
	config: JsonRecord,
	operation: string,
): Promise<import("imapflow").ImapFlow> {
	if (!hasImapCredentials(config)) {
		throw new Error("IMAP credentials not configured.");
	}

	const { ImapFlow } = await import("imapflow");
	const options = buildImapConnectionOptions(config);
	const client = new ImapFlow(options);
	log.info("imap_connection_settings", {
		operation,
		...sanitizeImapConnectionOptions(options),
	});

	try {
		await client.connect();
		return client;
	} catch (error) {
		const mode = options.secure
			? "TLS"
			: options.doSTARTTLS
				? "STARTTLS"
				: "plaintext";
		const message = `IMAP connection failed for ${options.host}:${options.port} (${mode}): ${toErrorMessage(error)}`;
		throw new Error(message);
	}
}

export interface ImapSyncResult {
	newCount: number;
	lastUid: number;
	mailbox: string;
}

export interface ImapFetchBodyResult {
	textBody: string;
	htmlBody: string;
}

export interface UnreadInboxMessage {
	uid: number;
	fromAddress: string;
	subject: string;
	date: string;
	flags: string;
}

export interface UnreadInboxResult {
	count: number;
	messages: UnreadInboxMessage[];
}

/**
 * Fetch messages that are currently unread AND still in the INBOX, read live
 * from the IMAP server. This reflects the true server state (messages read or
 * archived elsewhere are excluded), unlike the append-only local cache.
 */
export async function fetchUnreadInbox(
	config: JsonRecord,
	limit: number,
): Promise<UnreadInboxResult> {
	const client = await createConnectedImapClient(config, "fetchUnreadInbox");
	try {
		const lock = await client.getMailboxLock("INBOX");
		try {
			const status = await client.status("INBOX", { unseen: true });
			const count = status.unseen ?? 0;

			const uids = await client.search({ seen: false }, { uid: true });
			if (!uids || uids.length === 0) {
				return { count, messages: [] };
			}

			// Search returns ascending UIDs; the highest UIDs are the newest.
			const recent = uids.slice(-limit);
			const messages: UnreadInboxMessage[] = [];
			for await (const msg of client.fetch(
				recent,
				{ envelope: true, flags: true, uid: true },
				{ uid: true },
			)) {
				const envelope = msg.envelope;
				const fromAddr =
					envelope?.from
						?.map((a: { address?: string; name?: string }) =>
							a.name ? `${a.name} <${a.address}>` : a.address,
						)
						.join(", ") ?? "";
				messages.push({
					uid: msg.uid,
					fromAddress: fromAddr,
					subject: envelope?.subject ?? "",
					date: envelope?.date
						? new Date(envelope.date).toISOString()
						: new Date().toISOString(),
					flags: Array.from(msg.flags ?? []).join(","),
				});
			}

			messages.sort((a, b) => (a.date < b.date ? 1 : -1));
			return { count, messages };
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
}

/**
 * Sync an IMAP mailbox into the local SQLite cache:
 * - Fetch metadata for UIDs newer than the highest cached UID
 * - Prune cached messages that no longer exist on the server
 * - Refresh flags for remaining cached messages still on the server
 */
export async function syncMailbox(
	config: JsonRecord,
	mailbox: string,
	db: import("./db").EmailDb,
): Promise<ImapSyncResult> {
	const client = await createConnectedImapClient(
		config,
		`syncMailbox:${mailbox}`,
	);
	try {
		const lock = await client.getMailboxLock(mailbox);
		try {
			const lastUid = db.getSyncState(mailbox)?.lastUid ?? 0;
			const maxCachedUid = db.getMaxUid(mailbox);
			const cachedUids = db.getMessageUids(mailbox);

			// All UIDs currently present on the server for this mailbox.
			const serverUidsRaw = await client.search({ all: true }, { uid: true });
			const serverUids = Array.isArray(serverUidsRaw) ? serverUidsRaw : [];
			const serverUidSet = new Set<number>(serverUids);

			// Prune cache entries that the server no longer has.
			let prunedCount = 0;
			for (const uid of cachedUids) {
				if (!serverUidSet.has(uid)) {
					db.deleteMessage(uid, mailbox);
					prunedCount++;
				}
			}

			// Refresh flags for recent messages still on the server.
			// Cap the set so large mailboxes stay responsive on poll/post-write sync.
			const FLAG_REFRESH_LIMIT = 500;
			const remainingCached = cachedUids.filter((uid) => serverUidSet.has(uid));
			const flagsToRefresh =
				remainingCached.length > FLAG_REFRESH_LIMIT
					? remainingCached.slice(-FLAG_REFRESH_LIMIT)
					: remainingCached;
			if (flagsToRefresh.length > 0) {
				for await (const msg of client.fetch(
					flagsToRefresh,
					{ flags: true, uid: true },
					{ uid: true },
				)) {
					db.setMessageFlags(
						msg.uid,
						mailbox,
						Array.from(msg.flags ?? []).join(","),
					);
				}
			}

			// Fetch messages with UID > maxCachedUid (new since last sync).
			const newUids = serverUids.filter((uid) => uid > maxCachedUid);
			let newCount = 0;
			let highestUid = Math.max(lastUid, maxCachedUid);

			if (newUids.length > 0) {
				for await (const msg of client.fetch(
					newUids,
					{
						envelope: true,
						flags: true,
						uid: true,
						bodyStructure: true,
						internalDate: true,
					},
					{ uid: true },
				)) {
					const uid = msg.uid;
					if (uid <= maxCachedUid) continue;

					const envelope = msg.envelope;
					const fromAddr =
						envelope?.from
							?.map((a: { address?: string; name?: string }) =>
								a.name ? `${a.name} <${a.address}>` : a.address,
							)
							.join(", ") ?? "";
					const toAddr =
						envelope?.to
							?.map((a: { address?: string; name?: string }) =>
								a.name ? `${a.name} <${a.address}>` : a.address,
							)
							.join(", ") ?? "";
					const ccAddr =
						envelope?.cc
							?.map((a: { address?: string; name?: string }) =>
								a.name ? `${a.name} <${a.address}>` : a.address,
							)
							.join(", ") ?? "";

					db.upsertMessage({
						uid,
						mailbox,
						messageId: envelope?.messageId ?? "",
						fromAddress: fromAddr,
						toAddress: toAddr,
						ccAddress: ccAddr,
						subject: envelope?.subject ?? "",
						date: envelope?.date
							? new Date(envelope.date).toISOString()
							: new Date().toISOString(),
						snippet: "",
						flags: Array.from(msg.flags ?? []).join(","),
					});
					newCount++;
					if (uid > highestUid) highestUid = uid;
				}
			}

			if (highestUid > lastUid) {
				db.setSyncState(mailbox, highestUid);
			} else if (prunedCount > 0 || flagsToRefresh.length > 0) {
				// Touch sync timestamp so callers know a reconcile ran.
				db.setSyncState(mailbox, highestUid || lastUid);
			}

			log.debug("imap_sync_done", {
				mailbox,
				newCount,
				prunedCount,
				refreshedFlags: flagsToRefresh.length,
				highestUid,
			});
			return { newCount, lastUid: highestUid || lastUid, mailbox };
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
}

/**
 * Fetch the full body of a single message from IMAP and cache it in SQLite.
 */
export async function fetchMessageBody(
	config: JsonRecord,
	mailbox: string,
	uid: number,
	db: import("./db").EmailDb,
): Promise<ImapFetchBodyResult> {
	if (!hasImapCredentials(config)) {
		throw new Error("IMAP credentials not configured.");
	}

	const { simpleParser } = await import("mailparser");

	log.debug("imap_fetch_body", { mailbox, uid });
	const client = await createConnectedImapClient(config, "fetchMessageBody");
	try {
		const lock = await client.getMailboxLock(mailbox);
		try {
			const stream = await client.fetchOne(
				uid,
				{ source: true },
				{ uid: true },
			);
			if (!stream?.source) {
				log.warn("imap_body_not_found", { mailbox, uid });
				throw new Error(`Message ${uid} not found in ${mailbox}.`);
			}

			const parsed_msg = await simpleParser(
				stream.source as NodeJS.ReadableStream,
			);
			const textBody = parsed_msg.text ?? "";
			const htmlBody = parsed_msg.html ?? "";

			db.setMessageBody(uid, mailbox, textBody, String(htmlBody));
			return { textBody, htmlBody: String(htmlBody) };
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
}

/**
 * Send an email via SMTP using nodemailer.
 */
export async function sendEmail(
	config: JsonRecord,
	to: string[],
	subject: string,
	body: string,
	options?: { cc?: string[]; bcc?: string[] },
): Promise<{ messageId: string }> {
	const parsed = parseEmailConfig(config);
	if (!hasSmtpCredentials(config)) {
		throw new Error("SMTP credentials not configured.");
	}

	const nodemailer = await import("nodemailer");
	const transporter = nodemailer.createTransport({
		host: parsed.smtpHost,
		port: parsed.smtpPort,
		secure: parsed.smtpSecure,
		auth: {
			user: parsed.smtpUsername,
			pass: parsed.smtpPassword,
		},
	});

	log.info("smtp_send", {
		host: parsed.smtpHost,
		port: parsed.smtpPort,
		to: to.length,
		subject,
	});

	const fromAddr = parsed.fromAddress || parsed.smtpUsername;
	const from = parsed.fromName ? `${parsed.fromName} <${fromAddr}>` : fromAddr;

	const info = await transporter.sendMail({
		from,
		to: to.join(", "),
		cc: options?.cc?.join(", "),
		bcc: options?.bcc?.join(", "),
		subject,
		text: body,
	});

	log.info("smtp_sent", { messageId: info.messageId });
	await transporter.close();
	return { messageId: info.messageId };
}

/**
 * Test IMAP connection by logging in and listing the INBOX status.
 */
export async function testConnection(config: JsonRecord): Promise<void> {
	const client = await createConnectedImapClient(config, "testConnection");
	await client.logout();
	log.debug("imap_test_connection_ok");
}

/**
 * List all available IMAP mailboxes.
 */
export async function listMailboxes(
	config: JsonRecord,
): Promise<Array<{ path: string; name: string; specialUse?: string }>> {
	const client = await createConnectedImapClient(config, "listMailboxes");
	try {
		const mailboxes = await client.list();
		return mailboxes.map(
			(mb: { path: string; name: string; specialUse?: string }) => ({
				path: mb.path,
				name: mb.name,
				specialUse: mb.specialUse,
			}),
		);
	} finally {
		await client.logout();
	}
}

/**
 * Add IMAP flags to messages (e.g. \Seen, \Flagged, \Answered).
 */
export async function addFlags(
	config: JsonRecord,
	mailbox: string,
	uids: number[],
	flags: string[],
): Promise<void> {
	log.debug("imap_flags_add", { mailbox, uids: uids.length, flags });
	const client = await createConnectedImapClient(config, "addFlags");
	try {
		const lock = await client.getMailboxLock(mailbox);
		try {
			await client.messageFlagsAdd(uids, flags, { uid: true });
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
}

/**
 * Remove IMAP flags from messages.
 */
export async function removeFlags(
	config: JsonRecord,
	mailbox: string,
	uids: number[],
	flags: string[],
): Promise<void> {
	log.debug("imap_flags_remove", { mailbox, uids: uids.length, flags });
	const client = await createConnectedImapClient(config, "removeFlags");
	try {
		const lock = await client.getMailboxLock(mailbox);
		try {
			await client.messageFlagsRemove(uids, flags, { uid: true });
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
}

/**
 * Move messages to a different mailbox.
 */
export async function moveMessages(
	config: JsonRecord,
	mailbox: string,
	uids: number[],
	destination: string,
): Promise<void> {
	log.debug("imap_move", { mailbox, uids: uids.length, destination });
	const client = await createConnectedImapClient(config, "moveMessages");
	try {
		const lock = await client.getMailboxLock(mailbox);
		try {
			await client.messageMove(uids, destination, { uid: true });
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
}

export interface DeleteMessagesResult {
	/** When messages were moved to Trash, the Trash mailbox path. */
	trashPath?: string;
}

/**
 * Delete messages (move to Trash or set \Deleted and expunge).
 * If the server has a Trash mailbox, moves there; otherwise sets \Deleted.
 */
export async function deleteMessages(
	config: JsonRecord,
	mailbox: string,
	uids: number[],
): Promise<DeleteMessagesResult> {
	log.debug("imap_delete", { mailbox, uids: uids.length });
	const client = await createConnectedImapClient(config, "deleteMessages");
	try {
		// Try to find a Trash mailbox
		const mailboxes = await client.list();
		const trash = mailboxes.find(
			(mb: { specialUse?: string; path: string }) =>
				mb.specialUse === "\\Trash" ||
				/\\trash/i.test(mb.specialUse ?? "") ||
				/trash/i.test(mb.path),
		);

		if (trash && trash.path !== mailbox) {
			const lock = await client.getMailboxLock(mailbox);
			try {
				await client.messageMove(uids, trash.path, { uid: true });
			} finally {
				lock.release();
			}
			log.debug("imap_delete_moved_to_trash", { trash: trash.path });
			return { trashPath: trash.path };
		}
		// No Trash mailbox — set \Deleted and expunge
		const lock = await client.getMailboxLock(mailbox);
		try {
			await client.messageFlagsAdd(uids, ["\\Deleted"], { uid: true });
			await client.expunge();
		} finally {
			lock.release();
		}
		log.debug("imap_deleted_expunged");
		return {};
	} finally {
		await client.logout();
	}
}

/**
 * Archive messages by moving them to the server's archive/all-mail mailbox.
 * Detects the archive mailbox via the \All special-use flag or common names
 * (All Mail, Archive, All Emails). Falls back to [Gmail]/All Mail for Gmail.
 */
export async function archiveMessages(
	config: JsonRecord,
	mailbox: string,
	uids: number[],
): Promise<{ archivePath: string }> {
	log.debug("imap_archive", { mailbox, uids: uids.length });
	const client = await createConnectedImapClient(config, "archiveMessages");
	try {
		// Find the archive mailbox
		const mailboxes = await client.list();
		const archive = mailboxes.find(
			(mb: { specialUse?: string; path: string; name: string }) =>
				mb.specialUse === "\\All" ||
				/all[ -]?mail/i.test(mb.path) ||
				/all[ -]?mail/i.test(mb.name) ||
				/^archive$/i.test(mb.path) ||
				/^archive$/i.test(mb.name) ||
				/all[ -]?emails?/i.test(mb.path),
		);

		if (!archive) {
			throw new Error(
				"No archive mailbox found. Use moveToMailbox with an explicit destination instead.",
			);
		}

		if (archive.path === mailbox) {
			throw new Error("Messages are already in the archive mailbox.");
		}

		const lock = await client.getMailboxLock(mailbox);
		try {
			await client.messageMove(uids, archive.path, { uid: true });
		} finally {
			lock.release();
		}
		log.debug("imap_archive_done", {
			archivePath: archive.path,
			count: uids.length,
		});
		return { archivePath: archive.path };
	} finally {
		await client.logout();
	}
}
