import { executeAppleScript } from "./applescript";

/** True when local Mail.app automation is supported. */
export function isAppleMailPlatformSupported(): boolean {
	return process.platform === "darwin";
}

export function escapeForAppleScript(text: string): string {
	if (!text) return "";
	return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const AS_DATE_TO_STRING = `((year of d) as string) & "-" & ((month of d as integer) as string) & "-" & ((day of d) as string) & "-" & ((hours of d) as string) & "-" & ((minutes of d) as string) & "-" & ((seconds of d) as string)`;

export function parseAppleScriptDate(dateStr: string): Date {
	const numParts = dateStr.split("-").map(Number);
	if (numParts.length === 6 && numParts.every((n) => !Number.isNaN(n))) {
		const [y, mo, d, h, mi, s] = numParts;
		if (
			y === undefined ||
			mo === undefined ||
			d === undefined ||
			h === undefined ||
			mi === undefined ||
			s === undefined
		) {
			return new Date();
		}
		return new Date(y, mo - 1, d, h, mi, s);
	}
	const withoutPrefix = dateStr.replace(/^date\s+/, "");
	const normalized = withoutPrefix.replace(" at ", " ");
	const parsed = new Date(normalized);
	return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function buildAppLevelScript(command: string): string {
	return `
tell application "Mail"
${command}
end tell
`;
}

function buildAccountScopedScript(account: string, command: string): string {
	const safe = escapeForAppleScript(account);
	return `
tell application "Mail"
tell account "${safe}"
${command}
end tell
end tell
`;
}

const ITEM_SEP = "|||ITEM|||";
const FIELD_SEP = "|||";

export interface AppleMailMessageSummary {
	readonly id: string;
	readonly subject: string;
	readonly sender: string;
	readonly dateReceived: Date;
	readonly isRead: boolean;
	readonly isFlagged: boolean;
	readonly mailbox: string;
	readonly account: string;
}

function parseMessageBlock(
	line: string,
	defaultMailbox: string,
	accountName: string,
): AppleMailMessageSummary | null {
	const parts = line.split(FIELD_SEP);
	if (parts.length < 6) return null;
	const [id, subject, sender, dateStr, readStr, flagStr, mailboxName] = parts;
	const mb = mailboxName?.trim() || defaultMailbox;
	return {
		id: id ?? "",
		subject: subject ?? "",
		sender: sender ?? "",
		dateReceived: parseAppleScriptDate(dateStr ?? ""),
		isRead: readStr === "true",
		isFlagged: flagStr === "true",
		mailbox: mb,
		account: accountName,
	};
}

function parseMessageListOutput(
	output: string,
	defaultMailbox: string,
	accountName: string,
): AppleMailMessageSummary[] {
	const raw = output.trim();
	if (!raw) return [];
	return raw
		.split(ITEM_SEP)
		.map((chunk) => parseMessageBlock(chunk, defaultMailbox, accountName))
		.filter((m): m is AppleMailMessageSummary => m !== null);
}

const ACCOUNT_NAME_SEP = "<<<ACCT>>>";

function buildWhoseClauses(options: {
	readonly query?: string;
	readonly from?: string;
	readonly subject?: string;
	readonly unreadOnly?: boolean;
	readonly dateFrom?: string;
	readonly dateTo?: string;
}): string {
	const parts: string[] = [];
	if (options.unreadOnly) {
		parts.push("read status is false");
	}
	if (options.query?.trim()) {
		const q = escapeForAppleScript(options.query.trim());
		parts.push(`(subject contains "${q}" or sender contains "${q}")`);
	}
	if (options.from?.trim()) {
		const f = escapeForAppleScript(options.from.trim());
		parts.push(`sender contains "${f}"`);
	}
	if (options.subject?.trim()) {
		const s = escapeForAppleScript(options.subject.trim());
		parts.push(`subject contains "${s}"`);
	}
	if (options.dateFrom?.trim()) {
		const df = escapeForAppleScript(options.dateFrom.trim());
		parts.push(`date received >= (date "${df}")`);
	}
	if (options.dateTo?.trim()) {
		const dt = escapeForAppleScript(options.dateTo.trim());
		parts.push(`date received <= (date "${dt}")`);
	}
	if (parts.length === 0) return "";
	return ` whose ${parts.join(" and ")}`;
}

export async function testAppleMailConnection(): Promise<void> {
	if (!isAppleMailPlatformSupported()) {
		throw new Error("Apple Mail is only available on macOS.");
	}
	const result = executeAppleScript(
		buildAppLevelScript("return (count of accounts) as string"),
		{ timeoutMs: 15_000 },
	);
	if (!result.success) {
		throw new Error(result.error ?? "Mail.app check failed.");
	}
	if (!/^\d+$/.test(result.output) || Number(result.output) < 1) {
		throw new Error("Mail.app has no accounts configured.");
	}
}

const ACC_LIST_ITEM_SEP = "<<<ACCITEM>>>";
const ACC_NAME_EMAIL_SEP = "<<<EM>>>";

export interface AppleMailAccountSummary {
	readonly name: string;
	/** Primary / first email address when Mail.app exposes it. */
	readonly email?: string;
}

/** Parses `listAppleMailAccountsSync` AppleScript output (for tests). */
export function parseAppleMailAccountListOutput(
	raw: string,
): AppleMailAccountSummary[] {
	const out: AppleMailAccountSummary[] = [];
	for (const chunk of raw.split(ACC_LIST_ITEM_SEP)) {
		const line = chunk.trim();
		if (!line) continue;
		const [name, email] = line.split(ACC_NAME_EMAIL_SEP);
		const n = name?.trim();
		if (!n) continue;
		const e = email?.trim();
		out.push(e ? { name: n, email: e } : { name: n });
	}
	return out;
}

/**
 * Lists Mail.app accounts (display name and first email when available).
 */
export function listAppleMailAccountsSync(): AppleMailAccountSummary[] {
	if (!isAppleMailPlatformSupported()) {
		return [];
	}

	const script = buildAppLevelScript(`
set outputText to ""
repeat with acct in accounts
try
set accName to name of acct as string
set accEmail to ""
try
set addrList to email addresses of acct
if (count of addrList) > 0 then
set accEmail to item 1 of addrList as string
end if
end try
if length of outputText > 0 then set outputText to outputText & "${ACC_LIST_ITEM_SEP}"
set outputText to outputText & accName & "${ACC_NAME_EMAIL_SEP}" & accEmail
end try
end repeat
return outputText
`);

	const result = executeAppleScript(script, { timeoutMs: 20_000 });
	if (!result.success || !result.output.trim()) {
		return [];
	}

	return parseAppleMailAccountListOutput(result.output);
}

export async function listAppleMailAccounts(): Promise<
	AppleMailAccountSummary[]
> {
	return listAppleMailAccountsSync();
}

export interface SearchAppleMailParams {
	readonly query?: string;
	readonly from?: string;
	readonly subject?: string;
	readonly mailbox?: string;
	readonly account?: string;
	readonly unreadOnly?: boolean;
	readonly dateFrom?: string;
	readonly dateTo?: string;
	readonly limit?: number;
}

export function searchAppleMailEmailsSync(
	params: SearchAppleMailParams,
): AppleMailMessageSummary[] {
	if (!isAppleMailPlatformSupported()) {
		return [];
	}

	const limit = Math.min(Math.max(1, params.limit ?? 30), 200);
	const whosePart = buildWhoseClauses({
		query: params.query,
		from: params.from,
		subject: params.subject,
		unreadOnly: params.unreadOnly,
		dateFrom: params.dateFrom,
		dateTo: params.dateTo,
	});

	const searchInner = (
		mailboxName: string | undefined,
		cap: number,
		_accountName: string,
	) => {
		const mb = mailboxName?.trim();
		if (mb) {
			const safeMb = escapeForAppleScript(mb);
			return `
set outputText to ""
set theMailbox to mailbox "${safeMb}"
set allMessages to messages of theMailbox${whosePart}
set msgCount to 0
repeat with msg in allMessages
if msgCount >= ${cap} then exit repeat
try
set msgId to id of msg as string
set msgSubject to subject of msg
set msgSender to sender of msg
set d to date received of msg
set msgDateStr to ${AS_DATE_TO_STRING}
set msgRead to read status of msg as string
set msgFlagged to flagged status of msg as string
if msgCount > 0 then set outputText to outputText & "${ITEM_SEP}"
set outputText to outputText & msgId & "${FIELD_SEP}" & msgSubject & "${FIELD_SEP}" & msgSender & "${FIELD_SEP}" & msgDateStr & "${FIELD_SEP}" & msgRead & "${FIELD_SEP}" & msgFlagged & "${FIELD_SEP}" & "${escapeForAppleScript(mb)}"
set msgCount to msgCount + 1
end try
end repeat
return outputText
`;
		}
		return `
set outputText to ""
set msgCount to 0
set seenIds to {}
repeat with mb in mailboxes
if msgCount >= ${cap} then exit repeat
try
set allMessages to messages of mb${whosePart}
repeat with msg in allMessages
if msgCount >= ${cap} then exit repeat
try
set msgId to id of msg as string
if seenIds does not contain msgId then
set end of seenIds to msgId
set msgSubject to subject of msg
set msgSender to sender of msg
set d to date received of msg
set msgDateStr to ${AS_DATE_TO_STRING}
set msgRead to read status of msg as string
set msgFlagged to flagged status of msg as string
if msgCount > 0 then set outputText to outputText & "${ITEM_SEP}"
set outputText to outputText & msgId & "${FIELD_SEP}" & msgSubject & "${FIELD_SEP}" & msgSender & "${FIELD_SEP}" & msgDateStr & "${FIELD_SEP}" & msgRead & "${FIELD_SEP}" & msgFlagged & "${FIELD_SEP}" & (name of mb as string)
set msgCount to msgCount + 1
end if
end try
end repeat
end try
end repeat
return outputText
`;
	};

	const accountsToSearch: string[] = [];
	if (params.account?.trim()) {
		accountsToSearch.push(params.account.trim());
	} else {
		const listRes = executeAppleScript(
			buildAppLevelScript(`
set out to ""
repeat with acct in accounts
if length of out > 0 then set out to out & "${ACCOUNT_NAME_SEP}"
set out to out & (name of acct as string)
end repeat
return out
`),
			{ timeoutMs: 20_000 },
		);
		if (!listRes.success) return [];
		accountsToSearch.push(
			...listRes.output
				.split(ACCOUNT_NAME_SEP)
				.map((s) => s.trim())
				.filter(Boolean),
		);
	}

	const out: AppleMailMessageSummary[] = [];
	for (const acct of accountsToSearch) {
		if (out.length >= limit) break;
		const remaining = limit - out.length;
		const inner = searchInner(params.mailbox, remaining, acct);
		const script = buildAccountScopedScript(acct, inner);
		const result = executeAppleScript(script, { timeoutMs: 60_000 });
		if (!result.success || !result.output.trim()) continue;
		const parsed = parseMessageListOutput(
			result.output,
			params.mailbox?.trim() || "(all)",
			acct,
		);
		out.push(...parsed.slice(0, remaining));
	}

	return out.slice(0, limit);
}

export async function searchAppleMailEmails(
	params: SearchAppleMailParams,
): Promise<AppleMailMessageSummary[]> {
	return searchAppleMailEmailsSync(params);
}

export interface CreateAppleMailDraftParams {
	readonly to: readonly string[];
	readonly subject: string;
	readonly body: string;
	readonly cc?: readonly string[];
	readonly bcc?: readonly string[];
	readonly account?: string;
}

export function createAppleMailDraftSync(
	params: CreateAppleMailDraftParams,
): { ok: true; messageId: string } | { ok: false; error: string } {
	if (!isAppleMailPlatformSupported()) {
		return { ok: false, error: "Apple Mail is only available on macOS." };
	}

	const safeSubject = escapeForAppleScript(params.subject);
	const safeBody = escapeForAppleScript(params.body);

	let recipientCommands = "";
	for (const addr of params.to) {
		const a = escapeForAppleScript(addr.trim());
		if (!a) continue;
		recipientCommands += `make new to recipient at end of to recipients with properties {address:"${a}"}\n`;
	}
	if (params.cc) {
		for (const addr of params.cc) {
			const a = escapeForAppleScript(addr.trim());
			if (!a) continue;
			recipientCommands += `make new cc recipient at end of cc recipients with properties {address:"${a}"}\n`;
		}
	}
	if (params.bcc) {
		for (const addr of params.bcc) {
			const a = escapeForAppleScript(addr.trim());
			if (!a) continue;
			recipientCommands += `make new bcc recipient at end of bcc recipients with properties {address:"${a}"}\n`;
		}
	}

	let body: string;
	if (params.account?.trim()) {
		const acc = escapeForAppleScript(params.account.trim());
		body = `
set newMessage to make new outgoing message with properties {subject:"${safeSubject}", content:"${safeBody}", visible:false}
tell newMessage
${recipientCommands}
set sender to "${acc}"
end tell
set mid to id of newMessage as string
return mid
`;
	} else {
		body = `
set newMessage to make new outgoing message with properties {subject:"${safeSubject}", content:"${safeBody}", visible:false}
tell newMessage
${recipientCommands}
end tell
set mid to id of newMessage as string
return mid
`;
	}

	const result = executeAppleScript(buildAppLevelScript(body), {
		timeoutMs: 60_000,
		maxRetries: 2,
	});
	if (!result.success) {
		return { ok: false, error: result.error ?? "Failed to create draft." };
	}
	const id = result.output.trim();
	if (!/^\d+$/.test(id)) {
		return { ok: false, error: `Unexpected Mail.app response: ${id}` };
	}
	return { ok: true, messageId: id };
}

export async function createAppleMailDraft(
	params: CreateAppleMailDraftParams,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
	return createAppleMailDraftSync(params);
}

export interface UpdateAppleMailDraftParams {
	readonly id: string;
	readonly subject?: string;
	readonly body?: string;
	readonly to?: readonly string[];
	readonly cc?: readonly string[];
	readonly bcc?: readonly string[];
}

/**
 * Updates a draft by numeric message id. Only messages in Drafts-like mailboxes are updated.
 */
export function updateAppleMailDraftSync(
	params: UpdateAppleMailDraftParams,
): { ok: true } | { ok: false; error: string } {
	if (!isAppleMailPlatformSupported()) {
		return { ok: false, error: "Apple Mail is only available on macOS." };
	}
	const idNum = Number(params.id);
	if (!Number.isFinite(idNum) || idNum <= 0) {
		return {
			ok: false,
			error: "Draft id must be a positive numeric Mail message id.",
		};
	}

	const safeSubject =
		params.subject !== undefined ? escapeForAppleScript(params.subject) : null;
	const safeBody =
		params.body !== undefined ? escapeForAppleScript(params.body) : null;

	let recipientBlock = "";
	if (
		params.to !== undefined ||
		params.cc !== undefined ||
		params.bcc !== undefined
	) {
		let addTo = "";
		for (const addr of params.to ?? []) {
			const a = escapeForAppleScript(addr.trim());
			if (!a) continue;
			addTo += `make new to recipient at end of to recipients with properties {address:"${a}"}\n`;
		}
		let addCc = "";
		for (const addr of params.cc ?? []) {
			const a = escapeForAppleScript(addr.trim());
			if (!a) continue;
			addCc += `make new cc recipient at end of cc recipients with properties {address:"${a}"}\n`;
		}
		let addBcc = "";
		for (const addr of params.bcc ?? []) {
			const a = escapeForAppleScript(addr.trim());
			if (!a) continue;
			addBcc += `make new bcc recipient at end of bcc recipients with properties {address:"${a}"}\n`;
		}
		recipientBlock = `
repeat with r in to recipients of msg
try
delete r
end try
end repeat
repeat with r in cc recipients of msg
try
delete r
end try
end repeat
repeat with r in bcc recipients of msg
try
delete r
end try
end repeat
${addTo}${addCc}${addBcc}
`;
	}

	const setSubject =
		safeSubject !== null ? `set subject of msg to "${safeSubject}"\n` : "";
	const setContent =
		safeBody !== null ? `set content of msg to "${safeBody}"\n` : "";

	const draftCheckAS = `
set n to (name of mb as string)
set isDraft to (n contains "raft" or n contains "Draft" or n contains "DRAFT")
`;

	const script2 = buildAppLevelScript(`
try
repeat with acct in accounts
repeat with mb in mailboxes of acct
try
${draftCheckAS}
if isDraft then
set matchingMsgs to (messages of mb whose id is ${idNum})
if (count of matchingMsgs) > 0 then
set msg to item 1 of matchingMsgs
tell msg
${setSubject}${setContent}${recipientBlock}
end tell
return "ok"
end if
end if
end try
end repeat
end repeat
return "not_found"
on error errMsg
return "error:" & errMsg
end try
`);

	const result = executeAppleScript(script2, {
		timeoutMs: 60_000,
		maxRetries: 2,
	});
	if (!result.success) {
		return { ok: false, error: result.error ?? "Failed to update draft." };
	}
	const out = result.output.trim();
	if (out === "not_found") {
		return {
			ok: false,
			error:
				"No matching draft in a Drafts mailbox. Confirm the id from searchEmails and that the message is still a draft.",
		};
	}
	if (out.startsWith("error:")) {
		return { ok: false, error: out.slice("error:".length).trim() };
	}
	if (out === "ok") return { ok: true };
	return { ok: false, error: `Unexpected response: ${out}` };
}

export async function updateAppleMailDraft(
	params: UpdateAppleMailDraftParams,
): Promise<{ ok: true } | { ok: false; error: string }> {
	return updateAppleMailDraftSync(params);
}

const MB_ROW_SEP = "<<<MBROW>>>";
const MB_COL_SEP = "<<<MBCOL>>>";

export interface AppleMailMailboxRow {
	readonly account: string;
	readonly name: string;
}

export function parseMailboxListOutput(raw: string): AppleMailMailboxRow[] {
	const out: AppleMailMailboxRow[] = [];
	for (const chunk of raw.split(MB_ROW_SEP)) {
		const line = chunk.trim();
		if (!line) continue;
		const [acct, name] = line.split(MB_COL_SEP);
		const a = acct?.trim();
		const n = name?.trim();
		if (a && n) out.push({ account: a, name: n });
	}
	return out;
}

/** Lists mailbox names per account (for moveEmailToMailbox destinations). */
export function listMailboxesSync(account?: string): AppleMailMailboxRow[] {
	if (!isAppleMailPlatformSupported()) {
		return [];
	}

	const acc = account?.trim();
	const inner = `
set outputText to ""
repeat with mb in mailboxes
try
set mbName to name of mb as string
if length of outputText > 0 then set outputText to outputText & "${MB_ROW_SEP}"
set outputText to outputText & (name of account of mb as string) & "${MB_COL_SEP}" & mbName
end try
end repeat
return outputText
`;

	const script = acc
		? buildAccountScopedScript(acc, inner)
		: buildAppLevelScript(`
set outputText to ""
repeat with acct in accounts
repeat with mb in mailboxes of acct
try
set mbName to name of mb as string
if length of outputText > 0 then set outputText to outputText & "${MB_ROW_SEP}"
set outputText to outputText & (name of acct as string) & "${MB_COL_SEP}" & mbName
end try
end repeat
end repeat
return outputText
`);

	const result = executeAppleScript(script, { timeoutMs: 60_000 });
	if (!result.success || !result.output.trim()) {
		return [];
	}
	return parseMailboxListOutput(result.output);
}

function assertNumericMessageId(id: string): number | null {
	const n = Number(id);
	if (!Number.isFinite(n) || n <= 0) {
		return null;
	}
	return n;
}

/** Move message to an Archive-like mailbox on the same account (name contains "Archive" case variants). */
export function archiveAppleMailMessageSync(params: {
	readonly id: string;
	readonly account?: string;
}): { ok: true } | { ok: false; error: string } {
	if (!isAppleMailPlatformSupported()) {
		return { ok: false, error: "Apple Mail is only available on macOS." };
	}
	const idNum = assertNumericMessageId(params.id);
	if (idNum === null) {
		return {
			ok: false,
			error: "Message id must be a positive numeric Mail message id.",
		};
	}

	const archiveOneAccount = `
repeat with mb in mailboxes
try
set matchingMsgs to (messages of mb whose id is ${idNum})
if (count of matchingMsgs) > 0 then
set msg to item 1 of matchingMsgs
set destMb to missing value
repeat with amb in mailboxes
set nm to name of amb as string
if nm contains "Archive" or nm contains "archive" or nm contains "ARCHIVE" then
set destMb to amb
exit repeat
end if
end repeat
if destMb is missing value then return "no_archive"
move msg to destMb
return "ok"
end if
end try
end repeat
`;

	const scoped = params.account?.trim();
	const script = scoped
		? buildAppLevelScript(`
try
tell account "${escapeForAppleScript(scoped)}"
${archiveOneAccount}
return "not_found"
end tell
on error errMsg
return "error:" & errMsg
end try
`)
		: buildAppLevelScript(`
try
repeat with acct in accounts
tell acct
${archiveOneAccount}
end tell
end repeat
return "not_found"
on error errMsg
return "error:" & errMsg
end try
`);

	const result = executeAppleScript(script, {
		timeoutMs: 60_000,
		maxRetries: 2,
	});
	return interpretSimpleMailResult(result, {
		notFound: "Message not found. Use searchEmails for a current id.",
		noArchive:
			"No Archive-like mailbox on this account. Create an Archive folder in Mail or use moveMailMessage.",
	});
}

/** Sets Mail.app flagged status (closest built-in to a “tag”). */
export function setAppleMailMessageFlaggedSync(params: {
	readonly id: string;
	readonly flagged: boolean;
	readonly account?: string;
}): { ok: true } | { ok: false; error: string } {
	if (!isAppleMailPlatformSupported()) {
		return { ok: false, error: "Apple Mail is only available on macOS." };
	}
	const idNum = assertNumericMessageId(params.id);
	if (idNum === null) {
		return {
			ok: false,
			error: "Message id must be a positive numeric Mail message id.",
		};
	}

	const flagVal = params.flagged ? "true" : "false";
	const flagOneAccount = `
repeat with mb in mailboxes
try
set matchingMsgs to (messages of mb whose id is ${idNum})
if (count of matchingMsgs) > 0 then
set msg to item 1 of matchingMsgs
set flagged status of msg to ${flagVal}
return "ok"
end if
end try
end repeat
`;

	const scoped = params.account?.trim();
	const script = scoped
		? buildAppLevelScript(`
try
tell account "${escapeForAppleScript(scoped)}"
${flagOneAccount}
return "not_found"
end tell
on error errMsg
return "error:" & errMsg
end try
`)
		: buildAppLevelScript(`
try
repeat with acct in accounts
tell acct
${flagOneAccount}
end tell
end repeat
return "not_found"
on error errMsg
return "error:" & errMsg
end try
`);

	const result = executeAppleScript(script, {
		timeoutMs: 60_000,
		maxRetries: 2,
	});
	return interpretSimpleMailResult(result, {
		notFound: "Message not found.",
	});
}

/** Moves a message into a mailbox on the same account (use for “folder = label” workflows). */
export function moveAppleMailMessageSync(params: {
	readonly id: string;
	readonly mailbox: string;
	readonly account?: string;
}): { ok: true } | { ok: false; error: string } {
	if (!isAppleMailPlatformSupported()) {
		return { ok: false, error: "Apple Mail is only available on macOS." };
	}
	const idNum = assertNumericMessageId(params.id);
	if (idNum === null) {
		return {
			ok: false,
			error: "Message id must be a positive numeric Mail message id.",
		};
	}
	const destName = params.mailbox.trim();
	if (!destName) {
		return { ok: false, error: "Destination mailbox name is required." };
	}
	const safeMb = escapeForAppleScript(destName);

	const moveOneAccount = `
set destMb to mailbox "${safeMb}"
repeat with mb in mailboxes
try
set matchingMsgs to (messages of mb whose id is ${idNum})
if (count of matchingMsgs) > 0 then
set msg to item 1 of matchingMsgs
move msg to destMb
return "ok"
end if
end try
end repeat
`;

	const scoped = params.account?.trim();
	const script = scoped
		? buildAppLevelScript(`
try
tell account "${escapeForAppleScript(scoped)}"
${moveOneAccount}
return "not_found"
end tell
on error errMsg
return "error:" & errMsg
end try
`)
		: buildAppLevelScript(`
try
repeat with acct in accounts
tell acct
${moveOneAccount}
end tell
end repeat
return "not_found"
on error errMsg
return "error:" & errMsg
end try
`);

	const result = executeAppleScript(script, {
		timeoutMs: 60_000,
		maxRetries: 2,
	});
	return interpretSimpleMailResult(result, {
		notFound:
			"Message or destination mailbox not found. Try listMailboxes for exact mailbox names.",
	});
}

function interpretSimpleMailResult(
	result: { success: boolean; output: string; error?: string },
	messages: { notFound: string; noArchive?: string },
): { ok: true } | { ok: false; error: string } {
	if (!result.success) {
		return { ok: false, error: result.error ?? "Mail.app operation failed." };
	}
	const out = result.output.trim();
	if (out === "not_found") {
		return { ok: false, error: messages.notFound };
	}
	if (out === "no_archive" && messages.noArchive) {
		return { ok: false, error: messages.noArchive };
	}
	if (out.startsWith("error:")) {
		return { ok: false, error: out.slice("error:".length).trim() };
	}
	if (out === "ok") return { ok: true };
	return { ok: false, error: `Unexpected response: ${out}` };
}
