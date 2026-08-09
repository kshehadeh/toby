import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../plugin-email/src/db";
import { syncMailboxesAfterWrite } from "../../plugin-email/src/tools";

function canUseBunSqlite(): boolean {
	try {
		require("bun:sqlite");
		return true;
	} catch {
		return false;
	}
}

describe("email plugin post-write mailbox sync", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-email-sync-write-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it.skipIf(!canUseBunSqlite())(
		"syncMailboxesAfterWrite calls sync for each unique mailbox",
		async () => {
			const db = openDb(tempDir);
			try {
				const synced: string[] = [];
				const actions = await syncMailboxesAfterWrite(
					{ imapHost: "imap.example.com" },
					db,
					["INBOX", " Archive ", "INBOX", ""],
					async (_config, mailbox) => {
						synced.push(mailbox);
						return {
							newCount: mailbox === "INBOX" ? 2 : 0,
							lastUid: 10,
							mailbox,
						};
					},
				);

				expect(synced).toEqual(["INBOX", "Archive"]);
				expect(actions).toEqual([
					"Synced INBOX: 2 new message(s)",
					"Synced Archive: 0 new message(s)",
				]);
			} finally {
				db.close();
			}
		},
	);

	it.skipIf(!canUseBunSqlite())(
		"syncMailboxesAfterWrite continues when one mailbox sync fails",
		async () => {
			const db = openDb(tempDir);
			try {
				const synced: string[] = [];
				const actions = await syncMailboxesAfterWrite(
					{ imapHost: "imap.example.com" },
					db,
					["INBOX", "Trash"],
					async (_config, mailbox) => {
						if (mailbox === "INBOX") {
							throw new Error("IMAP unavailable");
						}
						synced.push(mailbox);
						return { newCount: 1, lastUid: 3, mailbox };
					},
				);

				expect(synced).toEqual(["Trash"]);
				expect(actions).toEqual(["Synced Trash: 1 new message(s)"]);
			} finally {
				db.close();
			}
		},
	);

	it.skipIf(!canUseBunSqlite())(
		"db helpers support prune/reconcile during sync",
		() => {
			const db = openDb(tempDir);
			try {
				db.upsertMessage({
					uid: 1,
					mailbox: "INBOX",
					messageId: "a@test",
					fromAddress: "a@example.com",
					toAddress: "b@example.com",
					ccAddress: "",
					subject: "one",
					date: "2026-01-01T00:00:00.000Z",
					snippet: "",
					flags: "",
				});
				db.upsertMessage({
					uid: 2,
					mailbox: "INBOX",
					messageId: "b@test",
					fromAddress: "a@example.com",
					toAddress: "b@example.com",
					ccAddress: "",
					subject: "two",
					date: "2026-01-02T00:00:00.000Z",
					snippet: "",
					flags: "\\Seen",
				});

				expect(db.getMessageUids("INBOX")).toEqual([1, 2]);
				db.setMessageFlags(2, "INBOX", "\\Seen,\\Flagged");
				expect(db.getMessageByUid(2, "INBOX")?.flags).toBe("\\Seen,\\Flagged");
				db.deleteMessage(1, "INBOX");
				expect(db.getMessageUids("INBOX")).toEqual([2]);
			} finally {
				db.close();
			}
		},
	);
});
