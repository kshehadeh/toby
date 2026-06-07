import Foundation

public enum MailTools {
	public static var definitions: [[String: Any]] {
		return [
		tool(
			name: "listMailAccounts",
			description:
				"List Mail.app account display names (and primary email when available). Use exact account names when passing the `account` filter to searchEmails, createDraft, archiveMailMessage, flagMailMessage, moveMailMessage, or listMailboxes.",
			readOnly: true,
			properties: [:]
		),
		tool(
			name: "searchEmails",
			description:
				"Search Apple Mail locally via Mail.app. Returns message id, subject, sender, date, read/flagged, mailbox, and account. Use numeric ids for updateDraft, archiveMailMessage, flagMailMessage, and moveMailMessage.",
			readOnly: true,
			properties: [
				"query": prop("string", "Match text in subject or sender", optional: true),
				"from": prop("string", "Filter: sender contains this text", optional: true),
				"subject": prop("string", "Filter: subject contains this text", optional: true),
				"mailbox": prop("string", "Mailbox name (e.g. INBOX). Omit to search all mailboxes in the account(s).", optional: true),
				"account": prop("string", "Account display name. Omit to search all accounts.", optional: true),
				"unreadOnly": prop("boolean", "Only unread messages", optional: true),
				"dateFrom": prop("string", "Start date for date received, e.g. January 1, 2026", optional: true),
				"dateTo": prop("string", "End date for date received", optional: true),
				"limit": prop("number", "Max results (default 30, max 200)", optional: true),
			]
		),
		tool(
			name: "listMailboxes",
			description:
				"List mailbox (folder) names per Mail.app account. Use exact mailbox names with moveMailMessage. Mail has no Gmail-style labels; folders are the practical equivalent.",
			readOnly: true,
			properties: [
				"account": prop("string", "Account display name; omit to list mailboxes for all accounts.", optional: true),
			]
		),
		tool(
			name: "createDraft",
			description: "Create a new draft in Mail.app (not sent). Returns messageId for later updateDraft.",
			properties: [
				"to": ["type": "array", "items": ["type": "string"], "description": "To addresses"],
				"subject": prop("string", "Subject"),
				"body": prop("string", "Body"),
				"cc": ["type": "array", "items": ["type": "string"], "description": "CC addresses"],
				"bcc": ["type": "array", "items": ["type": "string"], "description": "BCC addresses"],
				"account": prop("string", "Account name to send from / assign draft to", optional: true),
			],
			required: ["to", "subject", "body"]
		),
		tool(
			name: "updateDraft",
			description:
				"Update an existing draft by numeric messageId (from searchEmails or createDraft). Only works for messages in Drafts mailboxes.",
			properties: [
				"id": prop("string", "Numeric Mail.app message id"),
				"subject": prop("string", "New subject", optional: true),
				"body": prop("string", "New body", optional: true),
				"to": ["type": "array", "items": ["type": "string"], "description": "Replace To recipients"],
				"cc": ["type": "array", "items": ["type": "string"], "description": "CC recipients"],
				"bcc": ["type": "array", "items": ["type": "string"], "description": "BCC recipients"],
			],
			required: ["id"]
		),
		tool(
			name: "archiveMailMessage",
			description:
				"Archive a message in Mail.app by moving it to the first mailbox on the same account whose name contains \"Archive\" (case-insensitive). Requires a numeric message id from searchEmails.",
			properties: [
				"id": prop("string", "Numeric Mail message id"),
				"account": prop("string", "Account display name to limit the search; omit to search all accounts (slower).", optional: true),
			],
			required: ["id"]
		),
		tool(
			name: "flagMailMessage",
			description:
				"Set Mail.app flagged status on a message (built-in flag; closest to a tag). Requires numeric message id from searchEmails.",
			properties: [
				"id": prop("string", "Numeric Mail message id"),
				"flagged": prop("boolean", "true to flag, false to clear the flag"),
				"account": prop("string", "Account display name to limit the search; omit to search all accounts.", optional: true),
			],
			required: ["id", "flagged"]
		),
		tool(
			name: "moveMailMessage",
			description:
				"Move a message to a mailbox (folder) on the same Mail.app account — use for folder-as-label workflows. Prefer listMailboxes for exact mailbox names.",
			properties: [
				"id": prop("string", "Numeric Mail message id"),
				"mailbox": prop("string", "Destination mailbox name (folder)"),
				"account": prop("string", "Account display name to limit the search; omit to search all accounts.", optional: true),
			],
			required: ["id", "mailbox"]
		),
	]
	}

	public struct ExecuteResult {
		public let result: [String: Any]
		public let appliedActions: [String]
	}

	public static func execute(
		tool name: String,
		input: [String: Any],
		dryRun: Bool,
		maxResults: Int? = nil
	) -> Result<ExecuteResult, MailFailure> {
		guard MailClient.isPlatformSupported else {
			return .success(ExecuteResult(result: ["error": "Apple Mail tools only run on macOS."], appliedActions: []))
		}

		switch name {
		case "listMailAccounts":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would list Mail.app accounts."], appliedActions: []))
			}
			let accounts = MailClient.listAccounts()
			return .success(ExecuteResult(
				result: ["count": accounts.count, "accounts": accounts.map { $0.toDictionary() }],
				appliedActions: []
			))

		case "searchEmails":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would search Apple Mail with the given filters."], appliedActions: []))
			}
			let cap = min(max(1, intValue(input["limit"]) ?? maxResults ?? 30), 200)
			let params = MailClient.SearchParams(
				query: stringValue(input["query"]),
				from: stringValue(input["from"]),
				subject: stringValue(input["subject"]),
				mailbox: stringValue(input["mailbox"]),
				account: stringValue(input["account"]),
				unreadOnly: boolValue(input["unreadOnly"]) ?? false,
				dateFrom: stringValue(input["dateFrom"]),
				dateTo: stringValue(input["dateTo"]),
				limit: cap
			)
			let emails = MailClient.searchEmails(params)
			return .success(ExecuteResult(
				result: ["count": emails.count, "emails": emails.map { $0.toDictionary() }],
				appliedActions: []
			))

		case "listMailboxes":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would list Mail.app mailboxes."], appliedActions: []))
			}
			let rows = MailClient.listMailboxes(account: stringValue(input["account"]))
			return .success(ExecuteResult(
				result: ["count": rows.count, "mailboxes": rows.map { $0.toDictionary() }],
				appliedActions: []
			))

		case "createDraft":
			guard let to = stringArray(input["to"]), !to.isEmpty,
				let subject = stringValue(input["subject"]), !subject.isEmpty,
				let body = stringValue(input["body"]), !body.isEmpty
			else {
				return .failure(MailFailure(message: "to, subject, and body are required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would create draft to \(to.joined(separator: ", ")) — \"\(subject)\""
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			switch MailClient.createDraft(MailClient.CreateDraftParams(
				to: to,
				subject: subject,
				body: body,
				cc: stringArray(input["cc"]),
				bcc: stringArray(input["bcc"]),
				account: stringValue(input["account"])
			)) {
			case let .success(messageId):
				let line = "Created draft id \(messageId) — \"\(subject)\""
				return .success(ExecuteResult(
					result: ["success": true, "messageId": messageId, "subject": subject],
					appliedActions: [line]
				))
			case let .failure(error):
				return .success(ExecuteResult(result: ["error": error.message], appliedActions: []))
			}

		case "updateDraft":
			guard let id = stringValue(input["id"]) else { return .failure(MailFailure(message: "id is required.")) }
			let hasPatch = input["subject"] != nil || input["body"] != nil || input["to"] != nil || input["cc"] != nil || input["bcc"] != nil
			if !hasPatch {
				return .success(ExecuteResult(result: ["error": "Provide at least one of subject, body, to, cc, or bcc to update."], appliedActions: []))
			}
			if dryRun {
				let msg = "[DRY RUN] Would update draft id \(id)"
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			switch MailClient.updateDraft(MailClient.UpdateDraftParams(
				id: id,
				subject: stringValue(input["subject"]),
				body: stringValue(input["body"]),
				to: stringArray(input["to"]),
				cc: stringArray(input["cc"]),
				bcc: stringArray(input["bcc"])
			)) {
			case .success:
				let line = "Updated draft id \(id)."
				return .success(ExecuteResult(result: ["success": true, "id": id], appliedActions: [line]))
			case let .failure(error):
				return .success(ExecuteResult(result: ["error": error.message], appliedActions: []))
			}

		case "archiveMailMessage":
			guard let id = stringValue(input["id"]) else { return .failure(MailFailure(message: "id is required.")) }
			if dryRun {
				let msg = "[DRY RUN] Would archive Mail message id \(id)"
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			switch MailClient.archiveMessage(id: id, account: stringValue(input["account"])) {
			case .success:
				let line = "Archived Mail message id \(id)."
				return .success(ExecuteResult(result: ["success": true, "id": id], appliedActions: [line]))
			case let .failure(error):
				return .success(ExecuteResult(result: ["error": error.message], appliedActions: []))
			}

		case "flagMailMessage":
			guard let id = stringValue(input["id"]),
				let flagged = boolValue(input["flagged"])
			else { return .failure(MailFailure(message: "id and flagged are required.")) }
			if dryRun {
				let msg = "[DRY RUN] Would set flagged=\(flagged) on Mail message id \(id)"
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			switch MailClient.setMessageFlagged(id: id, flagged: flagged, account: stringValue(input["account"])) {
			case .success:
				let line = "Set flag on Mail message id \(id) to \(flagged)."
				return .success(ExecuteResult(result: ["success": true, "id": id, "flagged": flagged], appliedActions: [line]))
			case let .failure(error):
				return .success(ExecuteResult(result: ["error": error.message], appliedActions: []))
			}

		case "moveMailMessage":
			guard let id = stringValue(input["id"]),
				let mailbox = stringValue(input["mailbox"]), !mailbox.isEmpty
			else { return .failure(MailFailure(message: "id and mailbox are required.")) }
			if dryRun {
				let msg = "[DRY RUN] Would move Mail message id \(id) to mailbox \"\(mailbox)\""
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			switch MailClient.moveMessage(id: id, mailbox: mailbox, account: stringValue(input["account"])) {
			case .success:
				let line = "Moved Mail message id \(id) to \"\(mailbox)\"."
				return .success(ExecuteResult(result: ["success": true, "id": id, "mailbox": mailbox], appliedActions: [line]))
			case let .failure(error):
				return .success(ExecuteResult(result: ["error": error.message], appliedActions: []))
			}

		default:
			return .failure(MailFailure(message: "Unknown tool: \(name)"))
		}
	}

	private static func tool(
		name: String,
		description: String,
		readOnly: Bool = false,
		properties: [String: Any],
		required: [String] = []
	) -> [String: Any] {
		var schema: [String: Any] = [
			"type": "object",
			"properties": properties,
		]
		if !required.isEmpty {
			schema["required"] = required
		}
		var def: [String: Any] = [
			"name": name,
			"description": description,
			"inputSchema": schema,
		]
		if readOnly { def["readOnly"] = true }
		return def
	}

	private static func prop(_ type: String, _ description: String, optional: Bool = false) -> [String: Any] {
		var p: [String: Any] = ["type": type, "description": description]
		if optional { _ = optional }
		return p
	}

	private static func stringValue(_ value: Any?) -> String? {
		if let s = value as? String { return s }
		if let n = value as? NSNumber { return n.stringValue }
		return nil
	}

	private static func intValue(_ value: Any?) -> Int? {
		if let n = value as? Int { return n }
		if let d = value as? Double { return Int(d) }
		if let n = value as? NSNumber { return n.intValue }
		return nil
	}

	private static func boolValue(_ value: Any?) -> Bool? {
		if let b = value as? Bool { return b }
		if let n = value as? NSNumber { return n.boolValue }
		return nil
	}

	private static func stringArray(_ value: Any?) -> [String]? {
		if let arr = value as? [String] { return arr }
		if let arr = value as? [Any] {
			return arr.compactMap { stringValue($0) }
		}
		return nil
	}
}
