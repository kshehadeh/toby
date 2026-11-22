import type { FetchMessageObject, MessageStructureObject } from "imapflow";
import {
	BULK_HEADERS,
	createConnectedImapClient,
	isBulkMail,
	parseEmailConfig,
	parseHeaderBlock,
} from "./client";

type JsonRecord = Record<string, unknown>;

export function activityLimit(limit = 200): number {
	if (!Number.isInteger(limit) || limit < 1)
		throw new Error("limit must be a positive integer.");
	return Math.min(1000, limit);
}

export function activitySince(since: string): Date {
	if (
		!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(since) ||
		!Number.isFinite(Date.parse(since))
	) {
		throw new Error("since must be an ISO 8601 timestamp with an offset.");
	}
	return new Date(since);
}

export function emailThreadId(
	references = "",
	inReplyTo = "",
	messageId = "",
): string | undefined {
	const first = (raw: string) =>
		raw.match(/<([^<>]+)>/)?.[1] ?? raw.trim().split(/\s+/)[0];
	return (
		(first(references) || first(inReplyTo) || first(messageId))
			?.replace(/[<>]/g, "")
			.toLowerCase() || undefined
	);
}

/** Keep only new plain text before the common quote/signature delimiters. */
export function trimEmailSnippet(text: string): string {
	const lines: string[] = [];
	for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
		if (
			/^\s*(?:>|On .+wrote:|--\s*$|[-_]{2,}\s*Original Message|From:\s|Sent from my\b)/i.test(
				line,
			)
		)
			break;
		lines.push(line);
	}
	return lines.join("\n").trim().slice(0, 2000);
}

export interface EmailActivityMessage {
	mailbox: string;
	message: FetchMessageObject;
	text?: string;
}

export function toEmailActivity(
	messages: readonly EmailActivityMessage[],
	selfAddresses: readonly string[],
	since: string,
	limit = 200,
) {
	const cutoff = activitySince(since).getTime();
	const cap = activityLimit(limit);
	const self = new Set(
		selfAddresses
			.map((a) => a.trim().toLowerCase())
			.filter((a) => a.includes("@")),
	);
	const seen = new Set<string>();
	const observations = [...messages]
		.sort(
			(a, b) =>
				new Date(
					a.message.envelope?.date ?? a.message.internalDate ?? 0,
				).getTime() -
				new Date(
					b.message.envelope?.date ?? b.message.internalDate ?? 0,
				).getTime(),
		)
		.flatMap(({ mailbox, message, text }) => {
			const envelope = message.envelope;
			const date = new Date(
				envelope?.date ?? message.internalDate ?? Number.NaN,
			);
			if (!Number.isFinite(date.getTime()) || date.getTime() < cutoff)
				return [];
			const externalId =
				envelope?.messageId?.trim() || `${mailbox}:${message.uid}`;
			if (seen.has(externalId)) return [];
			seen.add(externalId);
			const headers = parseHeaderBlock(
				message.headers?.toString("utf-8") ?? "",
			);
			const actors = (["from", "to", "cc"] as const)
				.flatMap((role) =>
					(envelope?.[role] ?? []).map((a) => ({
						role,
						...(a.name ? { name: a.name.slice(0, 200) } : {}),
						...(a.address
							? { email: a.address.trim().toLowerCase().slice(0, 320) }
							: {}),
					})),
				)
				.slice(0, 100);
			const from = envelope?.from ?? [];
			const outbound = from.some((a) =>
				self.has(a.address?.trim().toLowerCase() ?? ""),
			);
			return [
				{
					externalId,
					kind: "email.message",
					threadId: emailThreadId(
						headers.get("references"),
						envelope?.inReplyTo,
						envelope?.messageId,
					),
					direction: outbound ? "outbound" : "inbound",
					occurredAt: date.toISOString(),
					title: (envelope?.subject ?? "").slice(0, 1000),
					excerpt: trimEmailSnippet(text ?? ""),
					actors,
					facts: {
						bulk: isBulkMail(headers, from[0]?.address ?? ""),
						direct: (envelope?.to ?? []).some((a) =>
							self.has(a.address?.trim().toLowerCase() ?? ""),
						),
						mailbox,
						seen: message.flags?.has("\\Seen") ?? false,
						answered: message.flags?.has("\\Answered") ?? false,
						flagged: message.flags?.has("\\Flagged") ?? false,
					},
				},
			];
		})
		.slice(0, cap);
	return { observations, self: { emails: [...self] } };
}

/** Select inline text only; never download attachment or embedded-message parts. */
export function activityTextPart(
	node?: MessageStructureObject,
): MessageStructureObject | undefined {
	if (
		!node ||
		node.disposition?.toLowerCase() === "attachment" ||
		node.parameters?.name ||
		node.dispositionParameters?.filename
	)
		return undefined;
	if (node.type === "text/plain" || node.type === "text/html") return node;
	if (!node.type.startsWith("multipart/")) return undefined;
	const parts = (node.childNodes ?? [])
		.map(activityTextPart)
		.filter((p): p is MessageStructureObject => Boolean(p));
	return parts.find((p) => p.type === "text/plain") ?? parts[0];
}

function messageTime(message: FetchMessageObject): number {
	return new Date(
		message.envelope?.date ?? message.internalDate ?? Number.NaN,
	).getTime();
}

/** The oldest `cap` messages at or after `cutoff`, oldest first. */
export function oldestSince(
	messages: readonly FetchMessageObject[],
	cutoff: number,
	cap: number,
): FetchMessageObject[] {
	return messages
		.filter((m) => {
			const time = messageTime(m);
			return Number.isFinite(time) && time >= cutoff;
		})
		.sort((a, b) => messageTime(a) - messageTime(b))
		.slice(0, cap);
}

export async function fetchRecentEmailActivity(
	config: JsonRecord,
	since: string,
	limit = 200,
) {
	const cutoff = activitySince(since);
	const cap = activityLimit(limit);
	const parsed = parseEmailConfig(config);
	const client = await createConnectedImapClient(config, "fetchRecentActivity");
	try {
		const mailboxes = await client.list();
		const sent =
			mailboxes.find((m) => m.specialUse === "\\Sent") ??
			["Sent", "Sent Items", "Sent Messages", "[Gmail]/Sent Mail"].flatMap(
				(name) =>
					mailboxes.filter(
						(m) =>
							m.path.toLowerCase() === name.toLowerCase() ||
							m.name.toLowerCase() === name.toLowerCase(),
					),
			)[0];
		const messages: EmailActivityMessage[] = [];
		const { simpleParser } = await import("mailparser");
		for (const mailbox of new Set(["INBOX", ...(sent ? [sent.path] : [])])) {
			const lock = await client.getMailboxLock(mailbox, { readOnly: true });
			try {
				const uids =
					(await client.search({ since: cutoff }, { uid: true })) || [];
				if (!uids.length) continue;
				// Finish the metadata iterator before fetching snippets (ImapFlow forbids nested commands).
				// IMAP SINCE is day-granular, so read metadata for every match and
				// keep the oldest `cap` at or after the exact cutoff: the core resumes
				// a full page from its newest item.
				const metadata: FetchMessageObject[] = [];
				for await (const message of client.fetch(
					uids,
					{
						envelope: true,
						flags: true,
						internalDate: true,
						bodyStructure: true,
						headers: [...BULK_HEADERS, "references"],
					},
					{ uid: true },
				))
					metadata.push(message);
				const batch = oldestSince(metadata, cutoff.getTime(), cap);
				for (const message of batch) {
					const part = activityTextPart(message.bodyStructure);
					let text = "";
					if (part) {
						const key = part.part || "1";
						const body = await client.fetchOne(
							message.uid,
							{
								bodyParts: [{ key, start: 0, maxLength: 8192 }],
							},
							{ uid: true },
						);
						const bytes = body === false ? undefined : body.bodyParts?.get(key);
						if (bytes) {
							const charset = (part.parameters?.charset ?? "utf-8").replace(
								/[\r\n"]/g,
								"",
							);
							const encoding = (part.encoding ?? "8bit").replace(/[\r\n]/g, "");
							const mime = Buffer.concat([
								Buffer.from(
									`Content-Type: ${part.type}; charset="${charset}"\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n`,
								),
								bytes,
							]);
							const content = await simpleParser(mime);
							text = content.text ?? "";
						}
					}
					messages.push({ mailbox, message, text });
				}
			} finally {
				lock.release();
			}
		}
		return toEmailActivity(
			messages,
			[parsed.imapUsername, parsed.fromAddress],
			since,
			cap,
		);
	} finally {
		await client.logout();
	}
}
