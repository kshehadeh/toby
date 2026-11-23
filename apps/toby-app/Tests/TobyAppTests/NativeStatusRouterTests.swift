import Foundation
import Testing
import TobyAI
@testable import TobyApp

@MainActor
@Suite("Native status payloads")
struct NativeStatusRouterTests {
	@Test func appStatusDecodes() throws {
		let home = FileManager.default.temporaryDirectory.appending(path: "toby-status-\(UUID().uuidString)")
		defer { try? FileManager.default.removeItem(at: home) }
		try FileManager.default.createDirectory(at: home.appending(path: "skills/demo"), withIntermediateDirectories: true)
		try Data("---\nname: demo\ndescription: A demo skill\n---\nBody".utf8).write(to: home.appending(path: "skills/demo/SKILL.md"))
		let json = NativeStatusRouter.appStatus(root: home, skillsRoot: home.appending(path: "skills"), chatModel: "openai/gpt-5", mailConfigured: true, slackConnected: false, signedIn: true)
		let status = try JSONDecoder().decode(AppStatus.self, from: Data(json.jsonString().utf8))
		#expect(status.model == "openai/gpt-5")
		#expect(status.connectedIntegrations == ["email"])
		#expect(status.hasConfiguredAIProvider == true)
		#expect(status.transcription?.configured == true)
		#expect(status.contextWindow?.supported == false)
	}

	@Test func daemonStatusDecodes() throws {
		let connected = try JSONDecoder().decode(DaemonStatus.self, from: Data(NativeStatusRouter.daemonStatus(enabled: true, state: .connected, lastError: nil, slackConnected: true).jsonString().utf8))
		#expect(connected.chatInbound?.isConnected == true)
		#expect(connected.process == nil)
		let off = try JSONDecoder().decode(DaemonStatus.self, from: Data(NativeStatusRouter.daemonStatus(enabled: false, state: nil, lastError: nil, slackConnected: false).jsonString().utf8))
		#expect(off.chatInbound?.isConnected == false)
		#expect(off.chatInbound?.disabledReason == "Chat replies are turned off.")
	}

	@Test func providersDecode() throws {
		let json = NativeStatusRouter.providers(configured: true, models: [])
		let providers = try JSONDecoder().decode(AIProvidersResponse.self, from: Data(json.jsonString().utf8)).providers
		#expect(providers.map(\.providerId) == ["openrouter"])
		#expect(providers.first?.configured == true)
	}

	@Test func legacyDeepLinksMapToSections() {
		#expect(NativeSettingsSection(navKey: "email") == .sources)
		#expect(NativeSettingsSection(navKey: "slack") == .sources)
		#expect(NativeSettingsSection(navKey: "ai") == .account)
		#expect(NativeSettingsSection(navKey: "transcription") == .recordings)
		#expect(NativeSettingsSection(navKey: "chatInbound") == .chatReplies)
		#expect(NativeSettingsSection(navKey: "icloud") == .sync)
		#expect(NativeSettingsSection(navKey: "personas.Toby") == .personas)
		#expect(NativeSettingsSection(navKey: "followups") == .followups)
		#expect(NativeSettingsSection(navKey: "unknown-key") == .general)
	}
}
