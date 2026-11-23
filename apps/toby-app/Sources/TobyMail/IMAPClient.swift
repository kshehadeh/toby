import Foundation

/// One IMAP session. Covers what Toby uses: LOGIN, LIST, SELECT, STATUS,
/// UID SEARCH/FETCH/STORE/MOVE/COPY, EXPUNGE.
public actor IMAPClient {
	public struct Envelope: Sendable, Equatable {
		public var date: Date?
		public var subject: String
		public var from: [MIME.Address]
		public var to: [MIME.Address]
		public var cc: [MIME.Address]
		public var inReplyTo: String
		public var messageID: String
	}

	public struct Message: Sendable, Equatable {
		public var uid: Int
		public var flags: [String] = []
		public var envelope: Envelope?
		public var internalDate: Date?
		public var headers: [String: String] = [:]
		public var source: Data?
		public var text: Data?
	}

	public struct Mailbox: Sendable, Equatable {
		public var path: String
		public var name: String
		public var specialUse: String?
		public var attributes: [String]
	}

	let stream: any MailStream
	var tagCounter = 0
	public private(set) var capabilities: Set<String> = []
	var selected: String?
	public private(set) var uidValidity: Int?

	public init(stream: any MailStream) {
		self.stream = stream
	}

	/// Connect, negotiate TLS (implicit on 993, STARTTLS on 143 when secure), and log in.
	public static func connect(_ server: MailServer, open: (@Sendable (String, Int, Bool) async throws -> any MailStream)? = nil) async throws -> IMAPClient {
		let implicitTLS = server.secure && server.port != 143
		let opener = open ?? { host, port, tls in try await StreamTaskConnection.open(host: host, port: port, tls: tls) }
		let stream: any MailStream
		do {
			stream = try await opener(server.host, server.port, implicitTLS)
		} catch {
			throw MailError.connection("IMAP connection failed for \(server.host):\(server.port) (\(implicitTLS ? "TLS" : server.secure ? "STARTTLS" : "plaintext")): \(error.localizedDescription)")
		}
		let client = IMAPClient(stream: stream)
		do {
			try await client.greeting()
			if server.secure, !implicitTLS {
				_ = try await client.command("STARTTLS")
				try await stream.startTLS()
				await client.resetCapabilities()
			}
			if await client.capabilities.isEmpty { _ = try await client.command("CAPABILITY") }
			_ = try await client.command(["LOGIN ", .argument(server.username), " ", .argument(server.password)])
			_ = try await client.command("CAPABILITY")
			return client
		} catch {
			await stream.close()
			throw error
		}
	}

	func resetCapabilities() { capabilities = [] }

	// MARK: Wire

	public enum Part: ExpressibleByStringLiteral, Sendable {
		case raw(String)
		case argument(String)
		public init(stringLiteral value: String) { self = .raw(value) }
	}

	func readResponse() async throws -> Data {
		var out = Data()
		while true {
			let line = try await stream.readLine()
			out.append(line)
			guard let count = IMAPParser.literalLength(line) else { return out }
			out.append(contentsOf: [13, 10])
			out.append(try await stream.readBytes(count))
		}
	}

	func greeting() async throws {
		let response = try await readResponse()
		let values = IMAPParser.parse(response)
		guard values.first?.text == "*", let status = values.dropFirst().first?.text?.uppercased(), status == "OK" || status == "PREAUTH" else {
			throw MailError.protocolError(String(decoding: response.prefix(200), as: UTF8.self))
		}
		noteCapabilities(response)
	}

	func noteCapabilities(_ response: Data) {
		let text = String(decoding: response.prefix(4000), as: UTF8.self)
		if let range = text.range(of: "CAPABILITY ", options: .caseInsensitive) {
			let tail = text[range.upperBound...].prefix { $0 != "]" }
			capabilities = Set(tail.split(separator: " ").map { $0.uppercased() })
		}
	}

	/// Send a command; returns untagged responses. Throws on NO/BAD.
	@discardableResult
	public func command(_ parts: [Part]) async throws -> [[IMAPValue]] {
		tagCounter += 1
		let tag = "T\(tagCounter)"
		var pending = Data("\(tag) ".utf8)
		for part in parts {
			switch part {
			case let .raw(text):
				pending.append(Data(text.utf8))
			case let .argument(value) where IMAPEncoding.needsLiteral(value):
				let bytes = Data(value.utf8)
				pending.append(Data("{\(bytes.count)}\r\n".utf8))
				try await stream.write(pending)
				pending = Data()
				let continuation = try await readResponse()
				guard continuation.first == 43 else { throw MailError.server(Self.message(continuation)) }
				pending.append(bytes)
			case let .argument(value):
				pending.append(Data(IMAPEncoding.quoted(value).utf8))
			}
		}
		pending.append(contentsOf: [13, 10])
		try await stream.write(pending)
		var untagged: [[IMAPValue]] = []
		while true {
			let response = try await readResponse()
			if response.starts(with: Data("\(tag) ".utf8)) {
				let values = IMAPParser.parse(response)
				noteCapabilities(response)
				guard values.dropFirst().first?.text?.uppercased() == "OK" else { throw MailError.server(Self.message(response)) }
				return untagged
			}
			if response.first == 42 {
				let values = IMAPParser.parse(response)
				if values.dropFirst().first?.text?.uppercased() == "CAPABILITY" {
					capabilities = Set(values.dropFirst(2).compactMap { $0.text?.uppercased() })
				}
				if values.dropFirst().first?.text?.uppercased() == "BYE" { throw MailError.closed }
				untagged.append(values)
			}
		}
	}

	public func command(_ raw: String) async throws -> [[IMAPValue]] { try await command([.raw(raw)]) }

	static func message(_ response: Data) -> String {
		let text = String(decoding: response.prefix(400), as: UTF8.self)
		let parts = text.split(separator: " ", maxSplits: 2)
		return parts.count == 3 ? String(parts[2]).replacing(/^\[[^\]]*\]\s*/, with: "") : text
	}

	// MARK: Mailboxes

	public func list() async throws -> [Mailbox] {
		try await command("LIST \"\" \"*\"").compactMap { values in
			guard values.count >= 5, values[1].text?.uppercased() == "LIST" else { return nil }
			let attributes = values[2].list?.compactMap(\.text) ?? []
			let raw = values[4].text ?? ""
			let path = IMAPEncoding.decodeMailboxName(raw)
			let delimiter = values[3].text ?? "/"
			let name = delimiter.isEmpty ? path : (path.components(separatedBy: delimiter).last ?? path)
			let special = attributes.first { ["\\all", "\\archive", "\\drafts", "\\flagged", "\\junk", "\\sent", "\\trash"].contains($0.lowercased()) }
			return Mailbox(path: path, name: name, specialUse: special, attributes: attributes)
		}
	}

	public func select(_ mailbox: String, readOnly: Bool = false) async throws {
		guard selected != mailbox else { return }
		let responses = try await command([.raw(readOnly ? "EXAMINE " : "SELECT "), .argument(IMAPEncoding.encodeMailboxName(mailbox))])
		uidValidity = responses.compactMap { values -> Int? in
			guard values.count >= 3, let code = values[2].text?.uppercased(),
			      code.hasPrefix("[UIDVALIDITY "), code.hasSuffix("]") else { return nil }
			return Int(code.dropFirst("[UIDVALIDITY ".count).dropLast())
		}.first
		selected = mailbox
	}

	public func unseenCount(_ mailbox: String) async throws -> Int {
		let responses = try await command([.raw("STATUS "), .argument(IMAPEncoding.encodeMailboxName(mailbox)), .raw(" (UNSEEN)")])
		for values in responses where values.dropFirst().first?.text?.uppercased() == "STATUS" {
			let items = values.last?.list ?? []
			var index = 0
			while index + 1 < items.count {
				if items[index].text?.uppercased() == "UNSEEN" { return items[index + 1].number ?? 0 }
				index += 2
			}
		}
		return 0
	}

	/// `UID SEARCH <criteria>` on the selected mailbox.
	public func search(_ criteria: String) async throws -> [Int] {
		try await command("UID SEARCH \(criteria)").flatMap { values -> [Int] in
			guard values.dropFirst().first?.text?.uppercased() == "SEARCH" else { return [] }
			return values.dropFirst(2).compactMap(\.number)
		}.sorted()
	}

	public static func searchDate(_ date: Date) -> String {
		let formatter = DateFormatter()
		formatter.locale = Locale(identifier: "en_US_POSIX")
		formatter.dateFormat = "d-MMM-yyyy"
		return formatter.string(from: date)
	}

	/// `UID FETCH` with an item list such as `(UID FLAGS ENVELOPE)`.
	public func fetch(_ uids: [Int], items: String) async throws -> [Message] {
		guard !uids.isEmpty else { return [] }
		var out: [Message] = []
		for chunk in stride(from: 0, to: uids.count, by: 200).map({ Array(uids[$0 ..< min($0 + 200, uids.count)]) }) {
			for values in try await command("UID FETCH \(IMAPEncoding.sequenceSet(chunk)) \(items)") {
				guard values.count >= 4, values[2].text?.uppercased() == "FETCH", let pairs = values[3].list else { continue }
				if let message = Self.message(pairs) { out.append(message) }
			}
		}
		return out
	}

	static func message(_ pairs: [IMAPValue]) -> Message? {
		var message = Message(uid: 0)
		var index = 0
		while index + 1 < pairs.count {
			let key = pairs[index].text?.uppercased() ?? ""
			let value = pairs[index + 1]
			switch key {
			case "UID": message.uid = value.number ?? 0
			case "FLAGS": message.flags = value.list?.compactMap(\.text) ?? []
			case "ENVELOPE": message.envelope = envelope(value)
			case "INTERNALDATE": message.internalDate = value.text.flatMap(IMAPEncoding.parseDate)
			default:
				if key.hasPrefix("BODY[HEADER"), let data = value.data {
					message.headers = MIME.headers(MIME.latin(data))
				} else if key.hasPrefix("BODY[TEXT]"), let data = value.data {
					message.text = data
				} else if key.hasPrefix("BODY[]") || key.hasPrefix("RFC822"), let data = value.data {
					message.source = data
				}
			}
			index += 2
		}
		return message.uid > 0 ? message : nil
	}

	static func envelope(_ value: IMAPValue) -> Envelope? {
		guard let fields = value.list, fields.count >= 10 else { return nil }
		func addresses(_ value: IMAPValue) -> [MIME.Address] {
			(value.list ?? []).compactMap { entry in
				guard let parts = entry.list, parts.count >= 4, let mailbox = parts[2].text else { return nil }
				let host = parts[3].text
				let email = host.map { "\(mailbox)@\($0)" } ?? mailbox
				let name = parts[0].text.map(MIME.decodeWords)?.trimmingCharacters(in: .whitespaces)
				return MIME.Address(name: name?.isEmpty == false ? name : nil, email: email)
			}
		}
		return Envelope(
			date: fields[0].text.flatMap(IMAPEncoding.parseDate),
			subject: fields[1].text.map(MIME.decodeWords) ?? "",
			from: addresses(fields[2]), to: addresses(fields[5]), cc: addresses(fields[6]),
			inReplyTo: fields[8].text ?? "", messageID: fields[9].text ?? "",
		)
	}

	// MARK: Writes

	public func store(_ uids: [Int], add: Bool, flags: [String]) async throws {
		guard !uids.isEmpty, !flags.isEmpty else { return }
		_ = try await command("UID STORE \(IMAPEncoding.sequenceSet(uids)) \(add ? "+" : "-")FLAGS.SILENT (\(flags.joined(separator: " ")))")
	}

	public func move(_ uids: [Int], to destination: String) async throws {
		guard !uids.isEmpty else { return }
		let set = IMAPEncoding.sequenceSet(uids)
		let target = IMAPEncoding.encodeMailboxName(destination)
		if capabilities.contains("MOVE") {
			try await command([.raw("UID MOVE \(set) "), .argument(target)])
			return
		}
		try await command([.raw("UID COPY \(set) "), .argument(target)])
		try await store(uids, add: true, flags: ["\\Deleted"])
		try await expunge(uids)
	}

	public func expunge(_ uids: [Int]? = nil) async throws {
		if let uids, capabilities.contains("UIDPLUS") {
			_ = try await command("UID EXPUNGE \(IMAPEncoding.sequenceSet(uids))")
		} else {
			_ = try await command("EXPUNGE")
		}
	}

	public func logout() async {
		_ = try? await command("LOGOUT")
		await stream.close()
	}
}
