import Foundation
import Testing
@testable import TobyMail

/// A scripted server: each step waits for a command starting with `expect`
/// (after the tag) and replies with `reply` (`{tag}` is substituted).
actor ScriptedStream: MailStream {
	struct Step {
		var expect: String
		var reply: String
	}

	var steps: [Step]
	var buffer = Data()
	private(set) var written: [String] = []
	private(set) var tlsStarted = false
	var awaitingLiteral: (tag: String, count: Int, rest: String)?

	init(greeting: String, _ steps: [Step]) {
		self.steps = steps
		buffer = Data(greeting.utf8)
	}

	func readLine() async throws -> Data {
		guard let range = buffer.firstRange(of: Data([13, 10])) else { throw MailError.closed }
		let line = buffer[buffer.startIndex ..< range.lowerBound]
		buffer.removeSubrange(buffer.startIndex ..< range.upperBound)
		return Data(line)
	}

	func readBytes(_ count: Int) async throws -> Data {
		guard buffer.count >= count else { throw MailError.closed }
		let bytes = buffer.prefix(count)
		buffer.removeFirst(count)
		return Data(bytes)
	}

	func write(_ data: Data) async throws {
		let text = String(decoding: data, as: UTF8.self)
		written.append(text)
		if let literal = IMAPParser.literalLength(Data(text.trimmingCharacters(in: .newlines).utf8)), text.hasSuffix("}\r\n") {
			buffer.append(Data("+ go ahead\r\n".utf8))
			awaitingLiteral = (String(text.prefix { $0 != " " }), literal, text)
			return
		}
		let full = (awaitingLiteral?.rest ?? "") + text
		let tag = awaitingLiteral?.tag ?? String(text.prefix { $0 != " " })
		awaitingLiteral = nil
		guard !steps.isEmpty else { return }
		let step = steps.removeFirst()
		let command = full.drop { $0 != " " }.dropFirst()
		#expect(command.hasPrefix(step.expect), "expected \(step.expect), got \(command)")
		buffer.append(Data(step.reply.replacingOccurrences(of: "{tag}", with: tag).utf8))
	}

	func startTLS() async throws { tlsStarted = true }
	func close() async {}
}

@Suite("IMAP")
struct IMAPTests {
	@Test func parsesFetchWithEnvelopeLiteralsAndHeaderSection() {
		let header = "List-ID: <news.example.com>\r\nPrecedence: bulk\r\n\r\n"
		let response = "* 3 FETCH (UID 41 FLAGS (\\Seen \\Flagged) ENVELOPE (\"Tue, 3 Sep 2024 10:11:12 -0700 (PDT)\" \"=?UTF-8?B?SMOpbGxv?= there\" ((\"Ana B\" NIL \"ana\" \"x.com\")) NIL NIL ((NIL NIL \"me\" \"y.com\")) NIL NIL NIL \"<m1@x.com>\") BODY[HEADER.FIELDS (LIST-ID PRECEDENCE)] {\(header.utf8.count)}\r\n\(header))"
		let values = IMAPParser.parse(Data(response.utf8))
		let message = IMAPClient.message(values[3].list!)!
		#expect(message.uid == 41)
		#expect(message.flags == ["\\Seen", "\\Flagged"])
		#expect(message.envelope?.subject == "Héllo there")
		#expect(message.envelope?.from == [MIME.Address(name: "Ana B", email: "ana@x.com")])
		#expect(message.envelope?.to.first?.email == "me@y.com")
		#expect(message.envelope?.messageID == "<m1@x.com>")
		#expect(message.envelope?.date == Date(timeIntervalSince1970: 1_725_383_472))
		#expect(message.headers["list-id"] == "<news.example.com>")
	}

	@Test func encodesSetsAndMailboxNames() {
		#expect(IMAPEncoding.sequenceSet([5, 1, 2, 3, 9, 8]) == "1:3,5,8:9")
		#expect(IMAPEncoding.encodeMailboxName("Entwürfe & Co") == "Entw&APw-rfe &- Co")
		#expect(IMAPEncoding.decodeMailboxName("Entw&APw-rfe &- Co") == "Entwürfe & Co")
		#expect(IMAPEncoding.decodeMailboxName("[Gmail]/All Mail") == "[Gmail]/All Mail")
	}

	@Test func logsInWithStartTLSAndLiteralPasswordThenSearchesAndMoves() async throws {
		let stream = ScriptedStream(greeting: "* OK [CAPABILITY IMAP4rev1 STARTTLS] ready\r\n", [
			.init(expect: "STARTTLS", reply: "{tag} OK begin TLS\r\n"),
			.init(expect: "CAPABILITY", reply: "* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n{tag} OK done\r\n"),
			.init(expect: "LOGIN \"me@x.com\" {7}", reply: "{tag} OK [CAPABILITY IMAP4rev1 MOVE UIDPLUS] logged in\r\n"),
			.init(expect: "CAPABILITY", reply: "* CAPABILITY IMAP4rev1 MOVE UIDPLUS\r\n{tag} OK done\r\n"),
			.init(expect: "SELECT \"INBOX\"", reply: "* 3 EXISTS\r\n{tag} OK [READ-WRITE] selected\r\n"),
			.init(expect: "UID SEARCH UNSEEN", reply: "* SEARCH 7 3 12\r\n{tag} OK done\r\n"),
			.init(expect: "UID MOVE 3,7 \"Archive\"", reply: "{tag} OK moved\r\n"),
			.init(expect: "UID STORE 12 +FLAGS.SILENT (\\Seen)", reply: "{tag} NO [CANNOT] read-only\r\n"),
		])
		let client = try await IMAPClient.connect(MailServer(host: "imap.x.com", port: 143, secure: true, username: "me@x.com", password: "pässwd")) { _, _, tls in
			#expect(!tls)
			return stream
		}
		#expect(await stream.tlsStarted)
		#expect(await client.capabilities.contains("MOVE"))
		try await client.select("INBOX")
		#expect(try await client.search("UNSEEN") == [3, 7, 12])
		try await client.move([7, 3], to: "Archive")
		await #expect(throws: MailError.server("read-only")) { try await client.store([12], add: true, flags: ["\\Seen"]) }
		#expect(await stream.written.contains { $0.hasSuffix("pässwd\r\n") })
	}

	@Test func listsSpecialUseMailboxes() async throws {
		let stream = ScriptedStream(greeting: "", [
			.init(expect: "LIST", reply: "* LIST (\\HasNoChildren \\Trash) \"/\" \"[Gmail]/Trash\"\r\n* LIST (\\HasNoChildren) \"/\" INBOX\r\n{tag} OK\r\n"),
		])
		let boxes = try await IMAPClient(stream: stream).list()
		#expect(boxes.map(\.path) == ["[Gmail]/Trash", "INBOX"])
		#expect(boxes[0].name == "Trash")
		#expect(boxes[0].specialUse == "\\Trash")
	}
}

@Suite("MIME")
struct MIMETests {
	@Test func decodesMultipartAlternativeWithCharsets() {
		let message = """
		From: =?ISO-8859-1?Q?Andr=E9?= <a@x.com>\r
		Subject: test\r
		Content-Type: multipart/alternative; boundary="b1"\r
		\r
		preamble\r
		--b1\r
		Content-Type: text/plain; charset=iso-8859-1\r
		Content-Transfer-Encoding: quoted-printable\r
		\r
		Caf=E9 au lait,=\r
		 s'il vous pla=EEt\r
		--b1\r
		Content-Type: text/html; charset=utf-8\r
		Content-Transfer-Encoding: base64\r
		\r
		PHA+Q2Fmw6k8L3A+\r
		--b1--\r

		"""
		let body = MIME.body(of: Data(message.utf8))
		#expect(body.text == "Café au lait, s'il vous plaît")
		#expect(body.html == "<p>Café</p>")
		let headers = MIME.headers(MIME.split(Data(message.utf8)).header)
		#expect(MIME.decodeWords(headers["from"]!) == "André <a@x.com>")
	}

	@Test func fallsBackToTextFromHTMLAndSkipsAttachments() {
		let message = "Content-Type: multipart/mixed; boundary=X\r\n\r\n--X\r\nContent-Type: text/html\r\n\r\n<html><head><style>p{}</style></head><body><p>Hi&nbsp;Ana</p><br>Line 2</body></html>\r\n--X\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=a.txt\r\n\r\nnot the body\r\n--X--\r\n"
		let body = MIME.body(of: Data(message.utf8))
		#expect(body.text == "Hi Ana\n\nLine 2")
	}

	@Test func unfoldsCRLFFoldedHeaders() {
		let message = "Subject: =?UTF-8?Q?Long?=\r\n =?UTF-8?Q?_subject?=\r\nContent-Type: multipart/alternative;\r\n\tboundary=\"=_b2\"\r\n\r\n--=_b2\r\nContent-Type: text/plain\r\n\r\nFolded ok\r\n--=_b2--\r\n"
		let headers = MIME.headers(MIME.split(Data(message.utf8)).header)
		#expect(MIME.contentType(headers["content-type"]).params["boundary"] == "=_b2")
		#expect(MIME.decodeWords(headers["subject"]!) == "Long subject")
		#expect(MIME.body(of: Data(message.utf8)).text == "Folded ok")
	}

	@Test func joinsAdjacentEncodedWords() {
		#expect(MIME.decodeWords("=?UTF-8?Q?Hello_?= =?UTF-8?Q?W=C3=B6rld?= today") == "Hello Wörld today")
		#expect(MIME.bareAddress("Ana B <ana@x.com>") == "ana@x.com")
	}
}

@Suite("SMTP and discovery")
struct SMTPTests {
	@Test func sendsWithStartTLSAuthPlainAndDotStuffing() async throws {
		let stream = ScriptedStream(greeting: "220 smtp.x.com ESMTP\r\n", [
			.init(expect: "toby.local", reply: "250-smtp.x.com\r\n250-STARTTLS\r\n250 AUTH LOGIN PLAIN\r\n"),
			.init(expect: "", reply: "220 go\r\n"),
			.init(expect: "toby.local", reply: "250-smtp.x.com\r\n250 AUTH LOGIN PLAIN\r\n"),
			.init(expect: "PLAIN", reply: "235 ok\r\n"),
			.init(expect: "FROM:<me@x.com>", reply: "250 ok\r\n"),
			.init(expect: "TO:<ana@y.com>", reply: "250 ok\r\n"),
			.init(expect: "TO:<bo@y.com>", reply: "250 ok\r\n"),
			.init(expect: "", reply: "354 go\r\n"),
			.init(expect: "", reply: ""),
			.init(expect: "", reply: "250 queued\r\n"),
			.init(expect: "", reply: "221 bye\r\n"),
		])
		let id = try await SMTPClient.send(
			.init(from: "Me Myself <me@x.com>", to: ["Ana <ana@y.com>"], bcc: ["bo@y.com"], subject: "Grüße", body: "Hi\n.hidden line\nbye"),
			server: MailServer(host: "smtp.x.com", port: 587, secure: false, username: "me@x.com", password: "pw"),
			open: { _, _, _ in stream },
		)
		#expect(id.hasSuffix("@x.com>"))
		#expect(await stream.tlsStarted)
		let data = await stream.written.first { $0.contains("Subject:") } ?? ""
		#expect(data.contains("Subject: =?UTF-8?B?R3LDvMOfZQ==?=\r\n"))
		#expect(data.contains("From: \"Me Myself\" <me@x.com>\r\n"))
		#expect(!data.contains("Bcc"))
		#expect(data.contains("\r\n..hidden line\r\n"))
		#expect(await stream.written.contains("AUTH PLAIN \(Data("\u{0}me@x.com\u{0}pw".utf8).base64EncodedString())\r\n"))
	}

	@Test func quotedPrintableWrapsLongLines() {
		let encoded = SMTPClient.encodeQuotedPrintable(String(repeating: "é", count: 40))
		#expect(encoded.components(separatedBy: "\r\n").allSatisfy { $0.count <= 76 })
		#expect(MIME.quotedPrintable(Data(encoded.utf8)) == Data(String(repeating: "é", count: 40).utf8))
	}

	@Test func discoversPresetsAndISPDB() async {
		let gmail = await MailDiscovery.discover("Me@GMail.com") { _ in nil }
		#expect(gmail?.source == "preset")
		#expect(gmail?.settings.smtpPort == "465")
		#expect(await MailDiscovery.discover("not an email") { _ in nil } == nil)
		let xml = """
		<clientConfig><emailProvider id="ex.org"><displayName>Example Mail</displayName>
		<incomingServer type="imap"><hostname>mail.ex.org</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILLOCALPART%</username></incomingServer>
		<outgoingServer type="smtp"><hostname>smtp.ex.org</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username></outgoingServer>
		</emailProvider></clientConfig>
		"""
		let custom = await MailDiscovery.discover("kim@ex.org") { _ in xml }
		#expect(custom?.source == "ispdb")
		#expect(custom?.providerName == "Example Mail")
		#expect(custom?.settings == .init(imapHost: "mail.ex.org", imapPort: "993", imapSecure: "true", imapUsername: "kim", smtpHost: "smtp.ex.org", smtpPort: "587", smtpSecure: "false", smtpUsername: "kim@ex.org", fromAddress: "kim@ex.org"))
	}
}
