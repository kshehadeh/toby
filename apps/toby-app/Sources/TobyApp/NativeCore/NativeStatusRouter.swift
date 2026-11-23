import Foundation
import TobyAI
import TobyCore

/// In-process `/api/status`, `/api/daemon/status`, and `/api/ai/providers`.
@MainActor
enum NativeStatusRouter {
	static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev" }

	static func appStatus() -> JSONValue {
		let runtime = NativeRuntime.shared
		return appStatus(
			root: runtime.paths.root, skillsRoot: runtime.paths.skills,
			chatModel: UserDefaults.standard.string(forKey: AccountSettingsModel.chatModelKey),
			mailConfigured: (try? runtime.mail().isConfigured) == true,
			slackConnected: runtime.slack.api.account().hasAccessToken,
			signedIn: ((try? KeychainKeyStore().read()) ?? nil)?.isEmpty == false,
		)
	}

	/// Pure builder (testable without the runtime).
	static func appStatus(root: URL, skillsRoot: URL, chatModel: String?, mailConfigured: Bool, slackConnected: Bool, signedIn: Bool) -> JSONValue {
		let personas = PersonaService(tobyDirectory: root)
		let persona = personas.defaultPersona()
		let skills = SkillService(root: skillsRoot).listJSON()["skills"]?.arrayValue ?? []
		let model = chatModel?.nilIfEmpty ?? persona.openRouterModel
		var connected: [JSONValue] = []
		if mailConfigured { connected.append("email") }
		if slackConnected { connected.append("slack") }
		return [
			"version": .string(version), "persona": .string(persona.name), "model": .string(model),
			"hasConfiguredAIProvider": .bool(signedIn),
			"tobyDir": .string(root.path), "contextWindow": ["supported": false, "unavailableReason": "Not reported in this version."],
			"personaImageUrl": .string("/api/personas/image/\(persona.imagePath ?? "default.png")"),
			"connectedIntegrations": .array(connected), "personaCount": .number(Double(personas.list().count)),
			"skillCount": .number(Double(skills.count)), "skills": .array(skills),
			// Recordings use Apple speech recognition on this Mac.
			"transcription": ["configured": true, "provider": "apple", "hasProviderAndModel": true, "hasApiKey": true, "needsApiKey": false],
		]
	}

	static func daemonStatus() async -> JSONValue {
		let enabled = AppConfigFile(tobyDirectory: NativeRuntime.shared.paths.root).value("chatInbound.enabled") == true
		var state: SlackInbound.State?
		var lastError: String?
		if let service = NativeRuntime.shared.slackInboundService {
			state = await service.state
			lastError = await service.lastError
		}
		return daemonStatus(enabled: enabled, state: state, lastError: lastError, slackConnected: NativeRuntime.shared.slack.api.account().hasAccessToken)
	}

	static func daemonStatus(enabled: Bool, state: SlackInbound.State?, lastError: String?, slackConnected: Bool) -> JSONValue {
		var inbound: [String: JSONValue] = ["enabled": .bool(enabled), "integration": "slack", "integrationLabel": "Slack"]
		if let state {
			inbound["status"] = .string(state == .connected ? "connected" : (state == .error ? "error" : (state == .stopped ? "disconnected" : "connecting")))
			if let lastError { inbound["detail"] = .string(lastError) }
		} else {
			inbound["status"] = "disconnected"
			if !enabled { inbound["disabledReason"] = "Chat replies are turned off." }
			else if !slackConnected { inbound["disabledReason"] = "Connect Slack in Settings → Sources." }
		}
		return ["chatInbound": .object(inbound)]
	}

	/// OpenRouter is the only provider; models come from the catalog.
	static func providers() async -> JSONValue {
		let configured = ((try? KeychainKeyStore().read()) ?? nil)?.isEmpty == false
		let list = configured ? ((try? await ModelCatalog(client: NativeRuntime.shared.ai).models()) ?? []) : []
		return providers(configured: configured, models: list)
	}

	static func providers(configured: Bool, models: [ModelInfo]) -> JSONValue {
		let options: [JSONValue] = models.map { ["id": .string($0.id), "displayName": .string($0.name), "reasoning": .bool($0.supportsReasoning), "structuredOutput": .bool($0.supportsStructuredOutputs)] }
		return ["providers": [["id": "openrouter", "displayName": "OpenRouter", "models": .array(options), "allowCustomModel": true, "configured": .bool(configured)]]]
	}
}

private extension String {
	var nilIfEmpty: String? { isEmpty ? nil : self }
}
