import Foundation

/// Minimal SMTP submission: implicit TLS (465) or opportunistic STARTTLS,
/// AUTH PLAIN/LOGIN, one plain-text UTF-8 message.
public enum SMTPClient {
	public struct Outgoing: Sendable {
		public var from: String
		public var to: [String]
		public var cc: [String]
		public var bcc: [String]
		public var subject: String
		public var body: String

		public init(from: String, to: [String], cc: [String] = [], bcc: [String] = [], subject: String, body: String) {
			self.from = from
			self.to = to
			self.cc = cc
			self.bcc = bcc
			self.subject = subject
			self.body = body
		}
	}

	struct Reply {
		var code: Int
		var lines: [String]
		var text: String { lines.joined(separator: " ") }
	}

	static func read(_ stream: any MailStream) async throws -> Reply {
		var lines: [String] = []
		while true {
			let line = String(decoding: try await stream.readLine(), as: UTF8.self)
			guard line.count >= 3, let code = Int(line.prefix(3)) else { throw MailError.protocolError(line) }
			lines.append(String(line.dropFirst(4)))
			if line.count == 3 || line[line.index(line.startIndex, offsetBy: 3)] != "-" { return Reply(code: code, lines: lines) }
		}
	}

	@discardableResult
	static func send(_ stream: any MailStream, _ command: String, expect: ClosedRange<Int> = 200 ... 399) async throws -> Reply {
		try await stream.write(Data("\(command)\r\n".utf8))
		let reply = try await read(stream)
		guard expect.contains(reply.code) else { throw MailError.server("SMTP \(reply.code): \(reply.text)") }
		return reply
	}

	/// Send a message; returns its Message-ID.
	public static func send(
		_ message: Outgoing,
		server: MailServer,
		open: (@Sendable (String, Int, Bool) async throws -> any MailStream)? = nil,
		now: Date = Date(),
	) async throws -> String {
		let opener = open ?? { host, port, tls in try await StreamTaskConnection.open(host: host, port: port, tls: tls) }
		let stream: any MailStream
		do {
			stream = try await opener(server.host, server.port, server.secure)
		} catch {
			throw MailError.connection("SMTP connection failed for \(server.host):\(server.port): \(error.localizedDescription)")
		}
		defer { Task { await stream.close() } }
		let greeting = try await read(stream)
		guard greeting.code == 220 else { throw MailError.server("SMTP \(greeting.code): \(greeting.text)") }
		var ehlo = try await send(stream, "EHLO toby.local")
		if !server.secure, ehlo.lines.contains(where: { $0.uppercased().hasPrefix("STARTTLS") }) {
			try await send(stream, "STARTTLS", expect: 220 ... 220)
			try await stream.startTLS()
			ehlo = try await send(stream, "EHLO toby.local")
		}
		let auth = ehlo.lines.first { $0.uppercased().hasPrefix("AUTH") }?.uppercased() ?? ""
		if !server.username.isEmpty {
			if auth.contains("PLAIN") || !auth.contains("LOGIN") {
				let token = Data("\u{0}\(server.username)\u{0}\(server.password)".utf8).base64EncodedString()
				try await send(stream, "AUTH PLAIN \(token)", expect: 235 ... 235)
			} else {
				try await send(stream, "AUTH LOGIN", expect: 334 ... 334)
				try await send(stream, Data(server.username.utf8).base64EncodedString(), expect: 334 ... 334)
				try await send(stream, Data(server.password.utf8).base64EncodedString(), expect: 235 ... 235)
			}
		}
		let sender = MIME.bareAddress(message.from)
		try await send(stream, "MAIL FROM:<\(sender)>")
		for recipient in message.to + message.cc + message.bcc { try await send(stream, "RCPT TO:<\(MIME.bareAddress(recipient))>") }
		try await send(stream, "DATA", expect: 354 ... 354)
		let messageID = "<\(UUID().uuidString.lowercased())@\(sender.split(separator: "@").last.map(String.init) ?? "toby.local")>"
		try await stream.write(render(message, messageID: messageID, date: now))
		try await stream.write(Data(".\r\n".utf8))
		let accepted = try await read(stream)
		guard accepted.code == 250 else { throw MailError.server("SMTP \(accepted.code): \(accepted.text)") }
		_ = try? await send(stream, "QUIT", expect: 200 ... 599)
		return messageID
	}

	/// RFC 5322 message with a quoted-printable UTF-8 body, dot-stuffed.
	public static func render(_ message: Outgoing, messageID: String, date: Date) -> Data {
		let formatter = DateFormatter()
		formatter.locale = Locale(identifier: "en_US_POSIX")
		formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
		var headers = [
			"From: \(encodeAddress(message.from))",
			"To: \(message.to.map(encodeAddress).joined(separator: ", "))",
		]
		if !message.cc.isEmpty { headers.append("Cc: \(message.cc.map(encodeAddress).joined(separator: ", "))") }
		headers += [
			"Subject: \(MIME.encodeWord(message.subject))", "Date: \(formatter.string(from: date))", "Message-ID: \(messageID)",
			"MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable",
		]
		let body = encodeQuotedPrintable(message.body).components(separatedBy: "\r\n").map { $0.hasPrefix(".") ? "." + $0 : $0 }
		return Data((headers.joined(separator: "\r\n") + "\r\n\r\n" + body.joined(separator: "\r\n") + "\r\n").utf8)
	}

	/// `Name <a@b>` with the name RFC 2047-encoded when needed.
	static func encodeAddress(_ raw: String) -> String {
		let email = MIME.bareAddress(raw)
		guard let open = raw.firstIndex(of: "<") else { return email }
		var name = raw[..<open].trimmingCharacters(in: .whitespaces)
		if name.hasPrefix("\""), name.hasSuffix("\""), name.count >= 2 { name = String(name.dropFirst().dropLast()) }
		guard !name.isEmpty else { return email }
		let encoded = MIME.encodeWord(name)
		return encoded == name ? "\"\(name.replacingOccurrences(of: "\"", with: "\\\""))\" <\(email)>" : "\(encoded) <\(email)>"
	}

	public static func encodeQuotedPrintable(_ text: String) -> String {
		let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
		return normalized.components(separatedBy: "\n").map { line -> String in
			var encoded: [String] = []
			var current = ""
			let bytes = Array(line.utf8)
			for (index, byte) in bytes.enumerated() {
				let isLast = index == bytes.count - 1
				let token: String = if byte == 61 || byte > 126 || (byte < 32 && byte != 9) || ((byte == 32 || byte == 9) && isLast) {
					String(format: "=%02X", byte)
				} else {
					String(UnicodeScalar(byte))
				}
				if current.count + token.count > 75 {
					encoded.append(current + "=")
					current = ""
				}
				current += token
			}
			encoded.append(current)
			return encoded.joined(separator: "\r\n")
		}.joined(separator: "\r\n")
	}
}
