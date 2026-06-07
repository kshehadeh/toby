import Foundation

struct AppleMailMessageSummary {
	let id: String
	let subject: String
	let sender: String
	let dateReceived: Date
	let isRead: Bool
	let isFlagged: Bool
	let mailbox: String
	let account: String

	func toDictionary() -> [String: Any] {
		[
			"id": id,
			"subject": subject,
			"sender": sender,
			"dateReceived": ISO8601DateFormatter().string(from: dateReceived),
			"isRead": isRead,
			"isFlagged": isFlagged,
			"mailbox": mailbox,
			"account": account,
		]
	}
}

public struct AppleMailAccountSummary {
	public let name: String
	public let email: String?

	func toDictionary() -> [String: Any] {
		var dict: [String: Any] = ["name": name]
		if let email { dict["email"] = email }
		return dict
	}
}

public struct AppleMailMailboxRow {
	public let account: String
	public let name: String

	func toDictionary() -> [String: Any] {
		["account": account, "name": name]
	}
}

public enum MailClient {
	public static var isPlatformSupported: Bool {
		#if os(macOS)
		return true
		#else
		return false
		#endif
	}

	private static let itemSep = "|||ITEM|||"
	private static let fieldSep = "|||"
	private static let accountNameSep = "<<<ACCT>>>"
	private static let accListItemSep = "<<<ACCITEM>>>"
	private static let accNameEmailSep = "<<<EM>>>"
	private static let mbRowSep = "<<<MBROW>>>"
	private static let mbColSep = "<<<MBCOL>>>"
	private static let asDateToString =
		"((year of d) as string) & \"-\" & ((month of d as integer) as string) & \"-\" & ((day of d) as string) & \"-\" & ((hours of d) as string) & \"-\" & ((minutes of d) as string) & \"-\" & ((seconds of d) as string)"

	public static func testConnection() throws {
		guard isPlatformSupported else {
			throw NSError(domain: "applemail", code: 1, userInfo: [NSLocalizedDescriptionKey: "Apple Mail is only available on macOS."])
		}
		let result = AppleScriptRunner.execute(
			buildAppLevelScript("return (count of accounts) as string"),
			timeoutMs: 15_000
		)
		guard result.success else {
			throw NSError(domain: "applemail", code: 1, userInfo: [NSLocalizedDescriptionKey: result.error ?? "Mail.app check failed."])
		}
		guard let count = Int(result.output), count >= 1 else {
			throw NSError(domain: "applemail", code: 1, userInfo: [NSLocalizedDescriptionKey: "Mail.app has no accounts configured."])
		}
	}

	public static func parseAppleMailAccountListOutput(_ raw: String) -> [AppleMailAccountSummary] {
		var out: [AppleMailAccountSummary] = []
		for chunk in raw.components(separatedBy: accListItemSep) {
			let line = String(chunk).trimmingCharacters(in: .whitespacesAndNewlines)
			guard !line.isEmpty else { continue }
			let parts = line.components(separatedBy: accNameEmailSep)
			let name = parts.first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			guard !name.isEmpty else { continue }
			let email = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : nil
			if let email, !email.isEmpty {
				out.append(AppleMailAccountSummary(name: name, email: email))
			} else {
				out.append(AppleMailAccountSummary(name: name, email: nil))
			}
		}
		return out
	}

	public static func parseMailboxListOutput(_ raw: String) -> [AppleMailMailboxRow] {
		var out: [AppleMailMailboxRow] = []
		for chunk in raw.components(separatedBy: mbRowSep) {
			let line = String(chunk).trimmingCharacters(in: .whitespacesAndNewlines)
			guard !line.isEmpty else { continue }
			let parts = line.components(separatedBy: mbColSep)
			guard parts.count >= 2 else { continue }
			let account = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
			let name = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
			if !account.isEmpty && !name.isEmpty {
				out.append(AppleMailMailboxRow(account: account, name: name))
			}
		}
		return out
	}

	static func listAccounts() -> [AppleMailAccountSummary] {
		guard isPlatformSupported else { return [] }
		let script = buildAppLevelScript("""
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
		if length of outputText > 0 then set outputText to outputText & "\(accListItemSep)"
		set outputText to outputText & accName & "\(accNameEmailSep)" & accEmail
		end try
		end repeat
		return outputText
		""")
		let result = AppleScriptRunner.execute(script, timeoutMs: 20_000)
		guard result.success, !result.output.isEmpty else { return [] }
		return parseAppleMailAccountListOutput(result.output)
	}

	struct SearchParams {
		var query: String?
		var from: String?
		var subject: String?
		var mailbox: String?
		var account: String?
		var unreadOnly: Bool = false
		var dateFrom: String?
		var dateTo: String?
		var limit: Int = 30
	}

	static func searchEmails(_ params: SearchParams) -> [AppleMailMessageSummary] {
		guard isPlatformSupported else { return [] }
		let limit = min(max(1, params.limit), 200)
		let whosePart = buildWhoseClauses(params)

		func searchInner(mailboxName: String?, cap: Int) -> String {
			if let mb = mailboxName?.trimmingCharacters(in: .whitespacesAndNewlines), !mb.isEmpty {
				let safeMb = AppleScriptRunner.escapeForAppleScript(mb)
				return """
				set outputText to ""
				set theMailbox to mailbox "\(safeMb)"
				set allMessages to messages of theMailbox\(whosePart)
				set msgCount to 0
				repeat with msg in allMessages
				if msgCount >= \(cap) then exit repeat
				try
				set msgId to id of msg as string
				set msgSubject to subject of msg
				set msgSender to sender of msg
				set d to date received of msg
				set msgDateStr to \(asDateToString)
				set msgRead to read status of msg as string
				set msgFlagged to flagged status of msg as string
				if msgCount > 0 then set outputText to outputText & "\(itemSep)"
				set outputText to outputText & msgId & "\(fieldSep)" & msgSubject & "\(fieldSep)" & msgSender & "\(fieldSep)" & msgDateStr & "\(fieldSep)" & msgRead & "\(fieldSep)" & msgFlagged & "\(fieldSep)" & "\(safeMb)"
				set msgCount to msgCount + 1
				end try
				end repeat
				return outputText
				"""
			}
			return """
			set outputText to ""
			set msgCount to 0
			set seenIds to {}
			repeat with mb in mailboxes
			if msgCount >= \(cap) then exit repeat
			try
			set allMessages to messages of mb\(whosePart)
			repeat with msg in allMessages
			if msgCount >= \(cap) then exit repeat
			try
			set msgId to id of msg as string
			if seenIds does not contain msgId then
			set end of seenIds to msgId
			set msgSubject to subject of msg
			set msgSender to sender of msg
			set d to date received of msg
			set msgDateStr to \(asDateToString)
			set msgRead to read status of msg as string
			set msgFlagged to flagged status of msg as string
			if msgCount > 0 then set outputText to outputText & "\(itemSep)"
			set outputText to outputText & msgId & "\(fieldSep)" & msgSubject & "\(fieldSep)" & msgSender & "\(fieldSep)" & msgDateStr & "\(fieldSep)" & msgRead & "\(fieldSep)" & msgFlagged & "\(fieldSep)" & (name of mb as string)
			set msgCount to msgCount + 1
			end if
			end try
			end repeat
			end try
			end repeat
			return outputText
			"""
		}

		var accountsToSearch: [String] = []
		if let account = params.account?.trimmingCharacters(in: .whitespacesAndNewlines), !account.isEmpty {
			accountsToSearch = [account]
		} else {
			let listScript = buildAppLevelScript("""
			set out to ""
			repeat with acct in accounts
			if length of out > 0 then set out to out & "\(accountNameSep)"
			set out to out & (name of acct as string)
			end repeat
			return out
			""")
			let listRes = AppleScriptRunner.execute(listScript, timeoutMs: 20_000)
			guard listRes.success else { return [] }
			accountsToSearch = listRes.output
				.components(separatedBy: accountNameSep)
				.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
				.filter { !$0.isEmpty }
		}

		var out: [AppleMailMessageSummary] = []
		for acct in accountsToSearch {
			if out.count >= limit { break }
			let remaining = limit - out.count
			let inner = searchInner(mailboxName: params.mailbox, cap: remaining)
			let script = buildAccountScopedScript(account: acct, command: inner)
			let result = AppleScriptRunner.execute(script, timeoutMs: 60_000)
			guard result.success, !result.output.isEmpty else { continue }
			let parsed = parseMessageListOutput(
				result.output,
				defaultMailbox: params.mailbox?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "(all)",
				accountName: acct
			)
			out.append(contentsOf: parsed.prefix(remaining))
		}
		return Array(out.prefix(limit))
	}

	static func listMailboxes(account: String? = nil) -> [AppleMailMailboxRow] {
		guard isPlatformSupported else { return [] }
		let inner = """
		set outputText to ""
		repeat with mb in mailboxes
		try
		set mbName to name of mb as string
		if length of outputText > 0 then set outputText to outputText & "\(mbRowSep)"
		set outputText to outputText & (name of account of mb as string) & "\(mbColSep)" & mbName
		end try
		end repeat
		return outputText
		"""
		let script: String
		if let acc = account?.trimmingCharacters(in: .whitespacesAndNewlines), !acc.isEmpty {
			script = buildAccountScopedScript(account: acc, command: inner)
		} else {
			script = buildAppLevelScript("""
			set outputText to ""
			repeat with acct in accounts
			repeat with mb in mailboxes of acct
			try
			set mbName to name of mb as string
			if length of outputText > 0 then set outputText to outputText & "\(mbRowSep)"
			set outputText to outputText & (name of acct as string) & "\(mbColSep)" & mbName
			end try
			end repeat
			end repeat
			return outputText
			""")
		}
		let result = AppleScriptRunner.execute(script, timeoutMs: 60_000)
		guard result.success, !result.output.isEmpty else { return [] }
		return parseMailboxListOutput(result.output)
	}

	struct CreateDraftParams {
		let to: [String]
		let subject: String
		let body: String
		let cc: [String]?
		let bcc: [String]?
		let account: String?
	}

	static func createDraft(_ params: CreateDraftParams) -> Result<String, MailFailure> {
		guard isPlatformSupported else { return .failure(MailFailure(message: "Apple Mail is only available on macOS.")) }
		let safeSubject = AppleScriptRunner.escapeForAppleScript(params.subject)
		let safeBody = AppleScriptRunner.escapeForAppleScript(params.body)
		var recipientCommands = ""
		for addr in params.to {
			let a = AppleScriptRunner.escapeForAppleScript(addr.trimmingCharacters(in: .whitespacesAndNewlines))
			guard !a.isEmpty else { continue }
			recipientCommands += "make new to recipient at end of to recipients with properties {address:\"\(a)\"}\n"
		}
		for addr in params.cc ?? [] {
			let a = AppleScriptRunner.escapeForAppleScript(addr.trimmingCharacters(in: .whitespacesAndNewlines))
			guard !a.isEmpty else { continue }
			recipientCommands += "make new cc recipient at end of cc recipients with properties {address:\"\(a)\"}\n"
		}
		for addr in params.bcc ?? [] {
			let a = AppleScriptRunner.escapeForAppleScript(addr.trimmingCharacters(in: .whitespacesAndNewlines))
			guard !a.isEmpty else { continue }
			recipientCommands += "make new bcc recipient at end of bcc recipients with properties {address:\"\(a)\"}\n"
		}

		let body: String
		if let account = params.account?.trimmingCharacters(in: .whitespacesAndNewlines), !account.isEmpty {
			let acc = AppleScriptRunner.escapeForAppleScript(account)
			body = """
			set newMessage to make new outgoing message with properties {subject:"\(safeSubject)", content:"\(safeBody)", visible:false}
			tell newMessage
			\(recipientCommands)
			set sender to "\(acc)"
			end tell
			set mid to id of newMessage as string
			return mid
			"""
		} else {
			body = """
			set newMessage to make new outgoing message with properties {subject:"\(safeSubject)", content:"\(safeBody)", visible:false}
			tell newMessage
			\(recipientCommands)
			end tell
			set mid to id of newMessage as string
			return mid
			"""
		}

		let result = AppleScriptRunner.execute(buildAppLevelScript(body), timeoutMs: 60_000, maxRetries: 2)
		guard result.success else {
			return .failure(MailFailure(message: result.error ?? "Failed to create draft."))
		}
		let id = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
		guard id.range(of: #"^\d+$"#, options: .regularExpression) != nil else {
			return .failure(MailFailure(message: "Unexpected Mail.app response: \(id)"))
		}
		return .success(id)
	}

	struct UpdateDraftParams {
		let id: String
		let subject: String?
		let body: String?
		let to: [String]?
		let cc: [String]?
		let bcc: [String]?
	}

	static func updateDraft(_ params: UpdateDraftParams) -> Result<Void, MailFailure> {
		guard isPlatformSupported else { return .failure(MailFailure(message: "Apple Mail is only available on macOS.")) }
		guard let idNum = assertNumericMessageId(params.id) else {
			return .failure(MailFailure(message: "Draft id must be a positive numeric Mail message id."))
		}

		let safeSubject = params.subject.map { AppleScriptRunner.escapeForAppleScript($0) }
		let safeBody = params.body.map { AppleScriptRunner.escapeForAppleScript($0) }

		var recipientBlock = ""
		if params.to != nil || params.cc != nil || params.bcc != nil {
			var addTo = ""
			for addr in params.to ?? [] {
				let a = AppleScriptRunner.escapeForAppleScript(addr.trimmingCharacters(in: .whitespacesAndNewlines))
				guard !a.isEmpty else { continue }
				addTo += "make new to recipient at end of to recipients with properties {address:\"\(a)\"}\n"
			}
			var addCc = ""
			for addr in params.cc ?? [] {
				let a = AppleScriptRunner.escapeForAppleScript(addr.trimmingCharacters(in: .whitespacesAndNewlines))
				guard !a.isEmpty else { continue }
				addCc += "make new cc recipient at end of cc recipients with properties {address:\"\(a)\"}\n"
			}
			var addBcc = ""
			for addr in params.bcc ?? [] {
				let a = AppleScriptRunner.escapeForAppleScript(addr.trimmingCharacters(in: .whitespacesAndNewlines))
				guard !a.isEmpty else { continue }
				addBcc += "make new bcc recipient at end of bcc recipients with properties {address:\"\(a)\"}\n"
			}
			recipientBlock = """
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
			\(addTo)\(addCc)\(addBcc)
			"""
		}

		let setSubject = safeSubject.map { "set subject of msg to \"\($0)\"\n" } ?? ""
		let setContent = safeBody.map { "set content of msg to \"\($0)\"\n" } ?? ""
		let draftCheckAS = """
		set n to (name of mb as string)
		set isDraft to (n contains "raft" or n contains "Draft" or n contains "DRAFT")
		"""

		let script = buildAppLevelScript("""
		try
		repeat with acct in accounts
		repeat with mb in mailboxes of acct
		try
		\(draftCheckAS)
		if isDraft then
		set matchingMsgs to (messages of mb whose id is \(idNum))
		if (count of matchingMsgs) > 0 then
		set msg to item 1 of matchingMsgs
		tell msg
		\(setSubject)\(setContent)\(recipientBlock)
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
		""")

		let result = AppleScriptRunner.execute(script, timeoutMs: 60_000, maxRetries: 2)
		return interpretSimpleMailResult(result, notFound: "No matching draft in a Drafts mailbox. Confirm the id from searchEmails and that the message is still a draft.", noArchive: nil)
	}

	static func archiveMessage(id: String, account: String? = nil) -> Result<Void, MailFailure> {
		guard isPlatformSupported else { return .failure(MailFailure(message: "Apple Mail is only available on macOS.")) }
		guard let idNum = assertNumericMessageId(id) else {
			return .failure(MailFailure(message: "Message id must be a positive numeric Mail message id."))
		}

		let archiveOneAccount = """
		repeat with mb in mailboxes
		try
		set matchingMsgs to (messages of mb whose id is \(idNum))
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
		"""

		let script: String
		if let scoped = account?.trimmingCharacters(in: .whitespacesAndNewlines), !scoped.isEmpty {
			script = buildAppLevelScript("""
			try
			tell account "\(AppleScriptRunner.escapeForAppleScript(scoped))"
			\(archiveOneAccount)
			return "not_found"
			end tell
			on error errMsg
			return "error:" & errMsg
			end try
			""")
		} else {
			script = buildAppLevelScript("""
			try
			repeat with acct in accounts
			tell acct
			\(archiveOneAccount)
			end tell
			end repeat
			return "not_found"
			on error errMsg
			return "error:" & errMsg
			end try
			""")
		}

		let result = AppleScriptRunner.execute(script, timeoutMs: 60_000, maxRetries: 2)
		return interpretSimpleMailResult(
			result,
			notFound: "Message not found. Use searchEmails for a current id.",
			noArchive: "No Archive-like mailbox on this account. Create an Archive folder in Mail or use moveMailMessage."
		)
	}

	static func setMessageFlagged(id: String, flagged: Bool, account: String? = nil) -> Result<Void, MailFailure> {
		guard isPlatformSupported else { return .failure(MailFailure(message: "Apple Mail is only available on macOS.")) }
		guard let idNum = assertNumericMessageId(id) else {
			return .failure(MailFailure(message: "Message id must be a positive numeric Mail message id."))
		}
		let flagVal = flagged ? "true" : "false"
		let flagOneAccount = """
		repeat with mb in mailboxes
		try
		set matchingMsgs to (messages of mb whose id is \(idNum))
		if (count of matchingMsgs) > 0 then
		set msg to item 1 of matchingMsgs
		set flagged status of msg to \(flagVal)
		return "ok"
		end if
		end try
		end repeat
		"""

		let script: String
		if let scoped = account?.trimmingCharacters(in: .whitespacesAndNewlines), !scoped.isEmpty {
			script = buildAppLevelScript("""
			try
			tell account "\(AppleScriptRunner.escapeForAppleScript(scoped))"
			\(flagOneAccount)
			return "not_found"
			end tell
			on error errMsg
			return "error:" & errMsg
			end try
			""")
		} else {
			script = buildAppLevelScript("""
			try
			repeat with acct in accounts
			tell acct
			\(flagOneAccount)
			end tell
			end repeat
			return "not_found"
			on error errMsg
			return "error:" & errMsg
			end try
			""")
		}

		let result = AppleScriptRunner.execute(script, timeoutMs: 60_000, maxRetries: 2)
		return interpretSimpleMailResult(result, notFound: "Message not found.", noArchive: nil)
	}

	static func moveMessage(id: String, mailbox: String, account: String? = nil) -> Result<Void, MailFailure> {
		guard isPlatformSupported else { return .failure(MailFailure(message: "Apple Mail is only available on macOS.")) }
		guard let idNum = assertNumericMessageId(id) else {
			return .failure(MailFailure(message: "Message id must be a positive numeric Mail message id."))
		}
		let destName = mailbox.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !destName.isEmpty else { return .failure(MailFailure(message: "Destination mailbox name is required.")) }
		let safeMb = AppleScriptRunner.escapeForAppleScript(destName)

		let moveOneAccount = """
		set destMb to mailbox "\(safeMb)"
		repeat with mb in mailboxes
		try
		set matchingMsgs to (messages of mb whose id is \(idNum))
		if (count of matchingMsgs) > 0 then
		set msg to item 1 of matchingMsgs
		move msg to destMb
		return "ok"
		end if
		end try
		end repeat
		"""

		let script: String
		if let scoped = account?.trimmingCharacters(in: .whitespacesAndNewlines), !scoped.isEmpty {
			script = buildAppLevelScript("""
			try
			tell account "\(AppleScriptRunner.escapeForAppleScript(scoped))"
			\(moveOneAccount)
			return "not_found"
			end tell
			on error errMsg
			return "error:" & errMsg
			end try
			""")
		} else {
			script = buildAppLevelScript("""
			try
			repeat with acct in accounts
			tell acct
			\(moveOneAccount)
			end tell
			end repeat
			return "not_found"
			on error errMsg
			return "error:" & errMsg
			end try
			""")
		}

		let result = AppleScriptRunner.execute(script, timeoutMs: 60_000, maxRetries: 2)
		return interpretSimpleMailResult(
			result,
			notFound: "Message or destination mailbox not found. Try listMailboxes for exact mailbox names.",
			noArchive: nil
		)
	}

	public static func validateTools() -> [[String: Any]] {
		var checks: [[String: Any]] = []
		guard isPlatformSupported else {
			return [["tool": "searchEmails", "ok": false, "details": "Not on macOS."]]
		}

		do {
			let sample = searchEmails(SearchParams(unreadOnly: true, limit: 1))
			checks.append([
				"tool": "searchEmails",
				"ok": true,
				"details": "Search completed (\(sample.count) unread match sample).",
			])
		}

		let accounts = listAccounts()
		checks.append([
			"tool": "listMailAccounts",
			"ok": !accounts.isEmpty,
			"details": accounts.isEmpty
				? "No accounts returned (check Mail.app)."
				: "Listed \(accounts.count) Mail account(s).",
		])

		let mailboxes = listMailboxes()
		checks.append([
			"tool": "listMailboxes",
			"ok": !mailboxes.isEmpty,
			"details": mailboxes.isEmpty
				? "No mailboxes returned (check Mail.app)."
				: "Listed \(mailboxes.count) mailbox row(s).",
		])

		for (tool, details) in [
			("createDraft", "Not executed; draft creation requires explicit user action in chat."),
			("updateDraft", "Not executed; draft updates require a draft id from search or create."),
			("archiveMailMessage", "Not executed; archiving requires a message id from search."),
			("flagMailMessage", "Not executed; flagging requires a message id from search."),
			("moveMailMessage", "Not executed; moves require a message id and mailbox name."),
		] {
			checks.append(["tool": tool, "ok": true, "details": details])
		}
		return checks
	}

	private static func buildAppLevelScript(_ command: String) -> String {
		"""
		tell application "Mail"
		\(command)
		end tell
		"""
	}

	private static func buildAccountScopedScript(account: String, command: String) -> String {
		let safe = AppleScriptRunner.escapeForAppleScript(account)
		return """
		tell application "Mail"
		tell account "\(safe)"
		\(command)
		end tell
		end tell
		"""
	}

	private static func buildWhoseClauses(_ params: SearchParams) -> String {
		var parts: [String] = []
		if params.unreadOnly {
			parts.append("read status is false")
		}
		if let query = params.query?.trimmingCharacters(in: .whitespacesAndNewlines), !query.isEmpty {
			let q = AppleScriptRunner.escapeForAppleScript(query)
			parts.append("(subject contains \"\(q)\" or sender contains \"\(q)\")")
		}
		if let from = params.from?.trimmingCharacters(in: .whitespacesAndNewlines), !from.isEmpty {
			let f = AppleScriptRunner.escapeForAppleScript(from)
			parts.append("sender contains \"\(f)\"")
		}
		if let subject = params.subject?.trimmingCharacters(in: .whitespacesAndNewlines), !subject.isEmpty {
			let s = AppleScriptRunner.escapeForAppleScript(subject)
			parts.append("subject contains \"\(s)\"")
		}
		if let dateFrom = params.dateFrom?.trimmingCharacters(in: .whitespacesAndNewlines), !dateFrom.isEmpty {
			let df = AppleScriptRunner.escapeForAppleScript(dateFrom)
			parts.append("date received >= (date \"\(df)\")")
		}
		if let dateTo = params.dateTo?.trimmingCharacters(in: .whitespacesAndNewlines), !dateTo.isEmpty {
			let dt = AppleScriptRunner.escapeForAppleScript(dateTo)
			parts.append("date received <= (date \"\(dt)\")")
		}
		if parts.isEmpty { return "" }
		return " whose " + parts.joined(separator: " and ")
	}

	private static func parseMessageBlock(
		_ line: String,
		defaultMailbox: String,
		accountName: String
	) -> AppleMailMessageSummary? {
		let parts = line.components(separatedBy: fieldSep)
		guard parts.count >= 6 else { return nil }
		let mailbox = parts.count > 6 ? parts[6].trimmingCharacters(in: .whitespacesAndNewlines) : defaultMailbox
		return AppleMailMessageSummary(
			id: parts[0],
			subject: parts[1],
			sender: parts[2],
			dateReceived: AppleScriptRunner.parseAppleScriptDate(parts[3]),
			isRead: parts[4] == "true",
			isFlagged: parts[5] == "true",
			mailbox: mailbox.isEmpty ? defaultMailbox : mailbox,
			account: accountName
		)
	}

	private static func parseMessageListOutput(
		_ output: String,
		defaultMailbox: String,
		accountName: String
	) -> [AppleMailMessageSummary] {
		let raw = output.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !raw.isEmpty else { return [] }
		return raw
			.components(separatedBy: itemSep)
			.compactMap { parseMessageBlock($0, defaultMailbox: defaultMailbox, accountName: accountName) }
	}

	private static func assertNumericMessageId(_ id: String) -> Int? {
		guard let n = Int(id), n > 0 else { return nil }
		return n
	}

	private static func interpretSimpleMailResult(
		_ result: AppleScriptResult,
		notFound: String,
		noArchive: String?
	) -> Result<Void, MailFailure> {
		guard result.success else {
			return .failure(MailFailure(message: result.error ?? "Mail.app operation failed."))
		}
		let out = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
		if out == "not_found" { return .failure(MailFailure(message: notFound)) }
		if out == "no_archive", let noArchive { return .failure(MailFailure(message: noArchive)) }
		if out.hasPrefix("error:") {
			return .failure(MailFailure(message: String(out.dropFirst("error:".count)).trimmingCharacters(in: .whitespacesAndNewlines)))
		}
		if out == "ok" { return .success(()) }
		return .failure(MailFailure(message: "Unexpected response: \(out)"))
	}
}
