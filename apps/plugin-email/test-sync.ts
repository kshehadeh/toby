#!/usr/bin/env bun
/**
 * Test script: exercise all email plugin tools end-to-end using stored credentials.
 * Usage: bun apps/plugin-email/test-sync.ts
 */

import fs from "node:fs";
// Relative import so this ad-hoc script does not need a package dependency on core.
import { readCredentials as readTobyCredentials } from "../../packages/core/src/config/index";
import { openDb } from "./src/db";
import { executeTool } from "./src/tools";

type JsonRecord = Record<string, unknown>;

function readCredentials(): JsonRecord {
	const creds = readTobyCredentials();
	return (creds.integrations?.email as JsonRecord) ?? {};
}

function printResult(label: string, result: unknown): void {
	const json = JSON.stringify(result, null, 2);
	const lines = json.split("\n");
	const preview = lines.slice(0, 15).join("\n");
	const truncated =
		lines.length > 15 ? `\n  ... (${lines.length - 15} more lines)` : "";
	console.log(`\n=== ${label} ===`);
	console.log(`  ${preview}${truncated}`);
}

function printActions(result: { appliedActions?: string[] }): void {
	if (result.appliedActions?.length) {
		console.log(`  Actions: ${result.appliedActions.join(", ")}`);
	}
}

async function main() {
	const config = readCredentials();
	const dataDir = "/tmp/toby-email-test-data";

	// Clean slate
	fs.rmSync(dataDir, { recursive: true, force: true });
	fs.mkdirSync(dataDir, { recursive: true });

	console.log("=== Email Plugin Tool Tests ===");
	console.log(`  Config: ${config.imapHost} as ${config.imapUsername}`);
	console.log(`  Data dir: ${dataDir}`);

	// -- Read tools (cache) --

	// 1. getInboxOverview before sync (should be empty)
	const beforeSync = await executeTool(
		"getInboxOverview",
		{},
		config,
		false,
		dataDir,
	);
	printResult("1. getInboxOverview (before sync)", beforeSync.result);

	// -- Sync --

	// 2. syncMailbox
	console.log("\n--- Syncing INBOX from IMAP ---");
	const syncResult = await executeTool(
		"syncMailbox",
		{ mailbox: "INBOX" },
		config,
		false,
		dataDir,
	);
	printResult("2. syncMailbox", syncResult.result);
	printActions(syncResult);

	// -- Read tools (after sync) --

	// 3. getInboxOverview after sync
	const afterSync = await executeTool(
		"getInboxOverview",
		{ limit: 5 },
		config,
		false,
		dataDir,
	);
	printResult("3. getInboxOverview (after sync, first 5)", afterSync.result);

	const overview = afterSync.result as {
		messages?: Array<{ uid: number; subject: string; flags: string }>;
	};
	const firstUid = overview?.messages?.[0]?.uid;
	const secondUid = overview?.messages?.[1]?.uid;

	// 4. getEmailMetadata
	if (firstUid) {
		const metadata = await executeTool(
			"getEmailMetadata",
			{ uids: [firstUid] },
			config,
			false,
			dataDir,
		);
		printResult(`4. getEmailMetadata (UID ${firstUid})`, metadata.result);
	}

	// 5. getEmailBody
	if (firstUid) {
		console.log("\n--- Fetching email body from IMAP ---");
		const body = await executeTool(
			"getEmailBody",
			{ uid: firstUid },
			config,
			false,
			dataDir,
		);
		printResult(`5. getEmailBody (UID ${firstUid})`, body.result);
	}

	// 6. searchEmails
	const search = await executeTool(
		"searchEmails",
		{ query: "a", limit: 3 },
		config,
		false,
		dataDir,
	);
	printResult("6. searchEmails (query='a', limit=3)", search.result);

	// -- Mailbox management --

	// 7. listMailboxes
	console.log("\n--- Listing IMAP mailboxes ---");
	const mailboxesResult = await executeTool(
		"listMailboxes",
		{},
		config,
		false,
		dataDir,
	);
	printResult("7. listMailboxes", mailboxesResult.result);

	// -- Flag tools --

	// 8. markAsRead
	if (firstUid) {
		console.log(`\n--- Marking UID ${firstUid} as read ---`);
		const markRead = await executeTool(
			"markAsRead",
			{ uids: [firstUid] },
			config,
			false,
			dataDir,
		);
		printResult(`8. markAsRead (UID ${firstUid})`, markRead.result);
		printActions(markRead);

		// Verify cache reflects the change
		const metaAfterRead = await executeTool(
			"getEmailMetadata",
			{ uids: [firstUid] },
			config,
			false,
			dataDir,
		);
		const readMeta = metaAfterRead.result as {
			messages?: Array<{ flags: string }>;
		};
		const hasSeen = readMeta.messages?.[0]?.flags?.includes("\\Seen");
		console.log(`  Cache check: \\Seen flag present = ${hasSeen}`);
	}

	// 9. markAsUnread
	if (firstUid) {
		const markUnread = await executeTool(
			"markAsUnread",
			{ uids: [firstUid] },
			config,
			false,
			dataDir,
		);
		printResult(`9. markAsUnread (UID ${firstUid})`, markUnread.result);
		printActions(markUnread);
	}

	// 10. setEmailFlags (star)
	if (firstUid) {
		const setFlags = await executeTool(
			"setEmailFlags",
			{ uids: [firstUid], add: ["\\Flagged"] },
			config,
			false,
			dataDir,
		);
		printResult(
			`10. setEmailFlags (add \\Flagged, UID ${firstUid})`,
			setFlags.result,
		);
		printActions(setFlags);

		// Remove the flag to clean up
		const removeFlags = await executeTool(
			"setEmailFlags",
			{ uids: [firstUid], remove: ["\\Flagged"] },
			config,
			false,
			dataDir,
		);
		printResult(
			"10b. setEmailFlags (remove \\Flagged, cleanup)",
			removeFlags.result,
		);
		printActions(removeFlags);
	}

	// -- Move (dry-run only to avoid disrupting mailbox) --

	// 11. moveToMailbox (dry run)
	if (firstUid) {
		const moveDry = await executeTool(
			"moveToMailbox",
			{ uids: [firstUid], destination: "[Gmail]/All Mail" },
			config,
			true, // dryRun — don't actually move
			dataDir,
		);
		printResult(
			`11. moveToMailbox (dry-run, UID ${firstUid} -> [Gmail]/All Mail)`,
			moveDry.result,
		);
		printActions(moveDry);
	}

	// -- Delete (dry-run only) --

	// 12. deleteEmail (dry run)
	if (secondUid) {
		const deleteDry = await executeTool(
			"deleteEmail",
			{ uids: [secondUid] },
			config,
			true, // dryRun — don't actually delete
			dataDir,
		);
		printResult(
			`12. deleteEmail (dry-run, UID ${secondUid})`,
			deleteDry.result,
		);
		printActions(deleteDry);
	} else if (firstUid) {
		const deleteDry = await executeTool(
			"deleteEmail",
			{ uids: [firstUid] },
			config,
			true,
			dataDir,
		);
		printResult(`12. deleteEmail (dry-run, UID ${firstUid})`, deleteDry.result);
		printActions(deleteDry);
	}

	// 12b. archiveEmail (dry run)
	if (firstUid) {
		const archiveDry = await executeTool(
			"archiveEmail",
			{ uids: [firstUid] },
			config,
			true, // dryRun — don't actually archive
			dataDir,
		);
		printResult(
			`12b. archiveEmail (dry-run, UID ${firstUid})`,
			archiveDry.result,
		);
		printActions(archiveDry);
	}

	// -- Drafts --

	// 13. listDrafts (should be empty)
	const draftsBefore = await executeTool(
		"listDrafts",
		{},
		config,
		false,
		dataDir,
	);
	printResult("13. listDrafts (before create)", draftsBefore.result);

	// 14. createDraft
	const createResult = await executeTool(
		"createDraft",
		{
			to: ["test@example.com"],
			subject: "Test Draft",
			body: "This is a test draft body.",
		},
		config,
		false,
		dataDir,
	);
	printResult("14. createDraft", createResult.result);
	printActions(createResult);
	const draftId = (createResult.result as { id?: string })?.id;

	// 15. listDrafts (after create)
	const draftsAfter = await executeTool(
		"listDrafts",
		{},
		config,
		false,
		dataDir,
	);
	printResult("15. listDrafts (after create)", draftsAfter.result);

	// 16. updateDraft
	if (draftId) {
		const updateResult = await executeTool(
			"updateDraft",
			{ id: draftId, subject: "Updated Test Draft" },
			config,
			false,
			dataDir,
		);
		printResult(`16. updateDraft (${draftId})`, updateResult.result);
		printActions(updateResult);
	}

	// 17. deleteDraft
	if (draftId) {
		const deleteResult = await executeTool(
			"deleteDraft",
			{ id: draftId },
			config,
			false,
			dataDir,
		);
		printResult(`17. deleteDraft (${draftId})`, deleteResult.result);
		printActions(deleteResult);
	}

	// -- DB Verification --

	const db = openDb(dataDir);
	const totalMsgs = db.countMessages("INBOX");
	const totalDrafts = db.listDrafts(100).length;
	const syncState = db.getSyncState("INBOX");
	db.close();

	console.log("\n=== DB Verification ===");
	console.log(`  Messages in cache: ${totalMsgs}`);
	console.log(`  Drafts in cache: ${totalDrafts}`);
	console.log(
		`  Sync state: mailbox=${syncState?.mailbox}, lastUid=${syncState?.lastUid}, lastSyncedAt=${syncState?.lastSyncedAt}`,
	);

	console.log("\n=== All tests complete ===");
}

main().catch((error) => {
	console.error(
		"Error:",
		error instanceof Error ? error.message : String(error),
	);
	console.error(error instanceof Error ? error.stack : "");
	process.exit(1);
});
