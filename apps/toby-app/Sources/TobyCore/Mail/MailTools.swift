import Foundation
import TobyAI
import GRDB
import TobyMail

/// Mail chat tools (formerly the email plugin's tools). Definitions come
/// from `Resources/mail-tools.json`; results keep the plugin's shapes.
extension MailService {
	struct ToolDefinition: Sendable {
		var name: String
		var title: String
		var description: String
		var readOnly: Bool
		var schema: JSONValue
	}

	static let toolDefinitions: [ToolDefinition] = {
		guard let url = Bundle.tobyCoreResources.url(forResource: "mail-tools", withExtension: "json", subdirectory: "Resources"),
		      let data = try? Data(contentsOf: url), let list = try? JSONDecoder().decode(JSONValue.self, from: data).arrayValue else { return [] }
		return list.compactMap { item in
			guard let name = item["name"]?.stringValue else { return nil }
			return ToolDefinition(name: name, title: item["title"]?.stringValue ?? name, description: item["description"]?.stringValue ?? "",
			                      readOnly: item["readOnly"] == true, schema: item["inputSchema"] ?? ["type": "object", "properties": [:]])
		}
	}()

	public func tools(dryRun: Bool) -> [ChatTool] {
		Self.toolDefinitions.map { definition in
			let service = self
			return ChatTool(tool: Tool(name: definition.name, description: definition.description, parameters: JSONSchema(definition.schema), readOnly: definition.readOnly) { args, _ in
				if dryRun, !definition.readOnly { return ["dryRun": true, "message": .string("Would run \(definition.title).")] }
				do {
					return try await service.execute(definition.name, ToolSchema.stripNulls(args))
				} catch {
					return ["error": .string((error as? LocalizedError)?.errorDescription ?? "\(error)")]
				}
			}, title: definition.title, readOnly: definition.readOnly)
		}
	}

	static func strings(_ value: JSONValue?) -> [String] { (value?.arrayValue ?? []).compactMap(\.stringValue) }
	static func numbers(_ value: JSONValue?) -> [Int] { (value?.arrayValue ?? []).compactMap { $0.doubleValue.map { Int($0) } } }
	static func truncate(_ text: String, _ max: Int) -> String {
		let t = text.replacingOccurrences(of: "\r\n", with: " ").replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
		return t.count <= max ? t : String(t.prefix(max - 1)) + "…"
	}

	static func split(_ list: String) -> [String] {
		list.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
	}

	func execute(_ tool: String, _ input: JSONValue) async throws -> JSONValue {
		let mailbox = input["mailbox"]?.stringValue ?? Self.defaultMailbox
		let limit = input["limit"]?.doubleValue.map { Int($0) }.flatMap { $0 == 0 ? nil : $0 }
		let uids = Self.numbers(input["uids"])
		let uidsMissing: JSONValue = ["error": "uids is required and must be non-empty"]
		let mailboxValue = JSONValue.string(mailbox)
		let uidValues = JSONValue.array(uids.map { .number(Double($0)) })
		switch tool {
		case "getInboxOverview":
			let page = try cachedMessages(mailbox, limit: limit ?? 50, offset: input["offset"]?.intValue ?? 0)
			return ["mailbox": mailboxValue, "total": .number(Double(page.total)), "pageSize": .number(Double(page.messages.count)), "messages": .array(page.messages)]
		case "getEmailMetadata":
			guard !uids.isEmpty else { return uidsMissing }
			let messages = try await writer.read { db in
				try uids.compactMap { uid in
					try Row.fetchOne(db, sql: "SELECT \(Self.summaryColumns) FROM mail_messages WHERE uid = ? AND mailbox = ?", arguments: [uid, mailbox]).map(Self.summaryJSON)
				}
			}
			return ["mailbox": mailboxValue, "messages": .array(messages)]
		case "getEmailBody":
			guard let uid = input["uid"]?.intValue, uid > 0 else { return ["error": "uid is required"] }
			let body = try await body(uid: uid, mailbox: mailbox)
			return ["uid": .number(Double(uid)), "mailbox": mailboxValue, "textBody": .string(body.text), "htmlBody": .string(body.html)]
		case "searchEmails":
			let query = (input["query"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
			guard !query.isEmpty else { return ["error": "query is required"] }
			let pattern = "%\(query)%"
			let results = try await writer.read { db in
				try Row.fetchAll(db, sql: """
				SELECT \(Self.summaryColumns) FROM mail_messages WHERE mailbox = ? AND (subject LIKE ? OR from_address LIKE ? OR to_address LIKE ? OR snippet LIKE ?)
				ORDER BY date DESC LIMIT ?
				""", arguments: [mailbox, pattern, pattern, pattern, pattern, limit ?? 20]).map(Self.summaryJSON)
			}
			return ["mailbox": mailboxValue, "query": .string(query), "results": .array(results)]
		case "syncMailbox":
			let result = try await sync(mailbox)
			return ["mailbox": mailboxValue, "newCount": .number(Double(result.newCount)), "lastUid": .number(Double(result.lastUid))]
		case "listMailboxes":
			return ["mailboxes": .array(try await mailboxes().map { ["path": .string($0.path), "name": .string($0.name), "specialUse": $0.specialUse.map(JSONValue.string) ?? .null] })]
		case "markAsRead", "markAsUnread":
			guard !uids.isEmpty else { return uidsMissing }
			let read = tool == "markAsRead"
			try await setFlags(uids, mailbox: mailbox, add: read ? ["\\Seen"] : [], remove: read ? [] : ["\\Seen"])
			return ["uids": uidValues, "mailbox": mailboxValue, "marked": .bool(read)]
		case "setEmailFlags":
			guard !uids.isEmpty else { return uidsMissing }
			let add = Self.strings(input["add"])
			let remove = Self.strings(input["remove"])
			guard !add.isEmpty || !remove.isEmpty else { return ["error": "At least one of add or remove must be provided"] }
			try await setFlags(uids, mailbox: mailbox, add: add, remove: remove)
			return ["uids": uidValues, "mailbox": mailboxValue, "added": .array(add.map(JSONValue.string)), "removed": .array(remove.map(JSONValue.string))]
		case "moveToMailbox":
			guard !uids.isEmpty else { return uidsMissing }
			let destination = (input["destination"]?.stringValue ?? "").trimmingCharacters(in: .whitespaces)
			guard !destination.isEmpty else { return ["error": "destination is required"] }
			try await move(uids, from: mailbox, to: destination)
			return ["uids": uidValues, "mailbox": mailboxValue, "destination": .string(destination), "moved": true]
		case "deleteEmail":
			guard !uids.isEmpty else { return uidsMissing }
			var result: [String: JSONValue] = ["uids": uidValues, "mailbox": mailboxValue, "deleted": true]
			if let trash = try await delete(uids, from: mailbox) { result["trashPath"] = .string(trash) }
			return .object(result)
		case "archiveEmail":
			guard !uids.isEmpty else { return uidsMissing }
			let path = try await archive(uids, from: mailbox)
			return ["uids": uidValues, "mailbox": mailboxValue, "archived": true, "archivePath": .string(path)]
		case "createDraft":
			let to = Self.strings(input["to"]), cc = Self.strings(input["cc"]), bcc = Self.strings(input["bcc"])
			let subject = input["subject"]?.stringValue ?? "", body = input["body"]?.stringValue ?? ""
			let id = try await createDraft(to: to, cc: cc, bcc: bcc, subject: subject, body: body)
			return ["id": .string(id), "to": .array(to.map(JSONValue.string)), "cc": .array(cc.map(JSONValue.string)), "bcc": .array(bcc.map(JSONValue.string)),
			        "subject": .string(subject), "bodyPreview": .string(Self.truncate(body, 100))]
		case "updateDraft":
			guard let id = input["id"]?.stringValue, !id.isEmpty else { return ["error": "id is required"] }
			guard try await draft(id) != nil else { return ["error": .string("Draft \(id) not found")] }
			var fields: [String: String] = [:]
			for (key, column) in [("to", "to_address"), ("cc", "cc_address"), ("bcc", "bcc_address")] where input[key]?.arrayValue != nil {
				fields[column] = Self.strings(input[key]).joined(separator: ", ")
			}
			if let subject = input["subject"]?.stringValue { fields["subject"] = subject }
			if let body = input["body"]?.stringValue { fields["body"] = body }
			try await updateDraft(id, fields: fields)
			return ["id": .string(id), "updated": true]
		case "listDrafts":
			return ["drafts": .array(try await listDrafts(limit: limit ?? 25).map { draft in
				var entry = draft.objectValue ?? [:]
				entry["bodyPreview"] = .string(Self.truncate(entry.removeValue(forKey: "body")?.stringValue ?? "", 100))
				return .object(entry)
			})]
		case "deleteDraft":
			guard let id = input["id"]?.stringValue, !id.isEmpty else { return ["error": "id is required"] }
			return ["id": .string(id), "deleted": .bool(try await deleteDraft(id))]
		case "sendEmail":
			let to = Self.strings(input["to"])
			guard !to.isEmpty else { return ["error": "to is required"] }
			let subject = input["subject"]?.stringValue ?? ""
			let id = try await send(to: to, cc: Self.strings(input["cc"]), bcc: Self.strings(input["bcc"]), subject: subject, body: input["body"]?.stringValue ?? "")
			return ["messageId": .string(id), "to": .array(to.map(JSONValue.string)), "subject": .string(subject)]
		case "sendDraft":
			guard let id = input["id"]?.stringValue, !id.isEmpty else { return ["error": "id is required"] }
			guard let draft = try await draft(id) else { return ["error": .string("Draft \(id) not found")] }
			let to = Self.split(draft["to"]?.stringValue ?? "")
			guard !to.isEmpty else { return ["error": "Draft has no recipients"] }
			let subject = draft["subject"]?.stringValue ?? ""
			let messageID = try await send(to: to, cc: Self.split(draft["cc"]?.stringValue ?? ""), bcc: Self.split(draft["bcc"]?.stringValue ?? ""), subject: subject, body: draft["body"]?.stringValue ?? "")
			try await deleteDraft(id)
			return ["messageId": .string(messageID), "draftId": .string(id), "to": .array(to.map(JSONValue.string)), "subject": .string(subject)]
		default:
			return ["error": .string("Unknown tool: \(tool)")]
		}
	}
}
