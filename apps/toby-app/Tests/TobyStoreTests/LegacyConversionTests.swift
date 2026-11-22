import Foundation
import Testing
import TobyAI
@testable import TobyStore

@Suite("Legacy message conversion")
struct LegacyMessageConverterTests {
	@Test func assistantPartsBecomeTextReasoningAndToolCalls() throws {
		let json = #"""
		[{"type":"reasoning","text":"","providerOptions":{"openai":{"itemId":"rs_1","reasoningEncryptedContent":"gAAA"}}},
		 {"type":"text","text":"Checking."},
		 {"type":"tool-call","toolCallId":"call_1","toolName":"listTobyTodos","input":{"filter":"today"}}]
		"""#
		let messages = LegacyMessageConverter.convert(role: "assistant", contentJSON: json)
		let message = try #require(messages.first)
		#expect(messages.count == 1)
		#expect(message.role == .assistant)
		#expect(message.text == "Checking.")
		#expect(message.reasoning == nil)
		#expect(message.toolCalls == [ToolCall(id: "call_1", name: "listTobyTodos", arguments: #"{"filter":"today"}"#)])
	}

	@Test func toolRowSplitsIntoOneMessagePerResult() {
		let json = #"""
		[{"type":"tool-result","toolCallId":"a","toolName":"sampleMutate","output":{"type":"json","value":{"recorded":"Test"}}},
		 {"type":"tool-result","toolCallId":"b","toolName":"boom","output":{"type":"error-text","value":"Disk on fire"}},
		 {"type":"tool-result","toolCallId":"c","toolName":"old","result":"legacy"}]
		"""#
		let messages = LegacyMessageConverter.convert(role: "tool", contentJSON: json)
		#expect(messages.map(\.toolCallId) == ["a", "b", "c"])
		#expect(messages.map(\.role) == [.tool, .tool, .tool])
		#expect(messages[0].text == #"{"recorded":"Test"}"#)
		#expect(messages[1].text == #"{"error":"Disk on fire"}"#)
		#expect(messages[2].text == "legacy")
		#expect(messages[1].toolName == "boom")
	}

	@Test func userStringsImagesAndFiles() {
		#expect(LegacyMessageConverter.convert(role: "user", contentJSON: #""Hello""#).first?.text == "Hello")
		let json = #"""
		[{"type":"text","text":"Look"},
		 {"type":"image","image":"AAAA","mediaType":"image/jpeg"},
		 {"type":"file","data":"https://example.com/a.pdf","mediaType":"application/pdf","filename":"a.pdf"},
		 {"type":"file","data":"BBBB","mediaType":"image/png","filename":"shot.png"}]
		"""#
		let message = LegacyMessageConverter.convert(role: "user", contentJSON: json).first
		#expect(message?.content == [
			.text("Look"),
			.image(url: "data:image/jpeg;base64,AAAA"),
			.file(filename: "a.pdf", dataURL: "https://example.com/a.pdf"),
			.image(url: "data:image/png;base64,BBBB"),
		])
	}

	@Test func systemAndUnknownRoles() {
		#expect(LegacyMessageConverter.convert(role: "system", contentJSON: #""Be kind""#).first == .system("Be kind"))
		#expect(LegacyMessageConverter.convert(role: "mystery", contentJSON: "{}").isEmpty)
		// Non-JSON content is treated as plain text.
		#expect(LegacyMessageConverter.convert(role: "user", contentJSON: "plain").first?.text == "plain")
	}
}

@Suite("Legacy credentials")
struct LegacyCredentialsTests {
	static let key = Data((0 ..< 32).map { UInt8($0) })

	@Test func decryptsEnvelopeWithKeychainKey() throws {
		let plaintext = #"{"ai":{"openrouter":{"apiKey":"sk-or-1"}}}"#
		let envelope = try LegacyCredentials.encryptForTesting(Data(plaintext.utf8), key: Self.key)
		let requested = SavedKey()
		let value = try LegacyCredentials.decode(Data(envelope.jsonString().utf8)) { service, account in
			requested.save("\(service)|\(account)")
			return Self.key
		}
		#expect(value["ai"]?["openrouter"]?["apiKey"] == "sk-or-1")
		#expect(requested.value == "dev.toby.credentials|data-encryption-key")
	}

	@Test func wrongOrMissingKeyFails() throws {
		let envelope = try LegacyCredentials.encryptForTesting(Data("{}".utf8), key: Self.key)
		let data = Data(envelope.jsonString().utf8)
		#expect(throws: LegacyCredentials.Failure.decryptionFailed) {
			try LegacyCredentials.decode(data) { _, _ in Data(repeating: 9, count: 32) }
		}
		#expect(throws: LegacyCredentials.Failure.missingDataKey) {
			try LegacyCredentials.decode(data) { _, _ in nil }
		}
	}

	@Test func plaintextPassesThrough() throws {
		let value = try LegacyCredentials.decode(Data(#"{"slack":{"botToken":"xoxb"}}"#.utf8)) { _, _ in nil }
		#expect(value["slack"]?["botToken"] == "xoxb")
	}

	@Test func mappingKeepsOnlySupportedSecrets() throws {
		let credentials = try JSONValue(parsing: #"""
		{"ai":{"openrouter":{"apiKey":"sk-or-1"},"openai":{"token":"sk-openai"}},
		 "integrations":{"email":{"imapPassword":"imap-pw","smtpPassword":"smtp-pw"},"jira":{"apiToken":"j"},"slack":{"appToken":"xapp"}},
		 "connections":{"mcp_github":{"token":"ghp"},"email":{"imapPassword":"older"}},
		 "slack":{"botToken":"xoxb","teamName":"Acme"},
		 "weather":{"apiKey":"w"},
		 "transcription":{"groq":{"apiKey":"g"}}}
		"""#)
		let mapping = LegacySecretMapping.from(credentials: credentials)
		#expect(mapping.openRouterKey == "sk-or-1")
		#expect(mapping.secrets == [
			"mail.imapPassword": "imap-pw",
			"mail.smtpPassword": "smtp-pw",
			"slack.appToken": "xapp",
			"slack.botToken": "xoxb",
			"slack.teamName": "Acme",
			"weather.apiKey": "w",
		])
	}
}
