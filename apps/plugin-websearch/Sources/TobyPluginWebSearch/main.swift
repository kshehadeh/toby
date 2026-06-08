import Foundation
import TobyPluginWebSearchLib

@main
enum TobyPluginWebSearch {
	static func main() {
		let args = Array(CommandLine.arguments.dropFirst())
		let command = args.first
		let subcommand = args.count > 1 ? args[1] : nil

		switch command {
		case "status":
			handleStatus(envelope: ConfigEnvelope.parse(PluginOutput.readStdin()))
		case "connect":
			handleConnect(envelope: ConfigEnvelope.parse(PluginOutput.readStdin()))
		case "disconnect":
			handleDisconnect()
		case "config":
			switch subcommand {
			case "shape":
				handleConfigShape()
			case "get":
				handleConfigGet(envelope: ConfigEnvelope.parse(PluginOutput.readStdin()))
			case "set":
				handleConfigSet()
			default:
				PluginOutput.emitError("Unknown config subcommand", code: "usage", exitCode: 2)
			}
		case "tools":
			switch subcommand {
			case "list":
				handleToolsList()
			case "execute":
				handleToolsExecute(raw: PluginOutput.readStdin())
			default:
				PluginOutput.emitError("Unknown tools subcommand", code: "usage", exitCode: 2)
			}
		default:
			PluginOutput.emitError("Unknown command: \(command ?? "(none)")", code: "usage", exitCode: 2)
		}
	}

	private static func handleStatus(envelope: ConfigEnvelope) {
		let connected = PluginOutput.isConnected(config: envelope.config, state: envelope.state)
		var payload: [String: Any] = [
			"ok": true,
			"name": PluginConstants.name,
			"displayName": PluginConstants.displayName,
			"description": PluginConstants.description,
			"version": PluginConstants.version,
			"protocolVersion": PluginConstants.protocolVersion,
			"connected": connected,
			"capabilities": ["chat"],
			"providerCategories": ["search"],
			"resources": ["web search"],
			"chatModelPrep": Prompts.buildChatModelPrep(),
			"chatReadiness": Prompts.buildChatReadiness(config: envelope.config, state: envelope.state),
		]

		if connected && SearchClient.hasApiKey(config: envelope.config) {
			do {
				try SearchClient.testConnection(config: envelope.config)
				payload["details"] = "Brave Search API reachable."
			} catch {
				payload["ok"] = false
				payload["details"] = "Connected, but Brave Search API check failed: \(error.localizedDescription)"
			}
		} else if SearchClient.hasApiKey(config: envelope.config) && !connected {
			payload["details"] =
				"Brave Search API key configured. Run `toby connect websearch` to mark connected, or use chat directly."
		} else {
			payload["details"] =
				"Web Search is not connected. Run `toby connect websearch` after configuring your Brave Search API key."
		}

		if envelope.validateTools && SearchClient.hasApiKey(config: envelope.config) {
			let toolChecks = SearchClient.validateTools(config: envelope.config)
			payload["tools"] = toolChecks
			let failed = toolChecks.filter { ($0["ok"] as? Bool) == false }
			if failed.isEmpty {
				payload["details"] = "Successfully authenticated and validated \(toolChecks.count)/\(toolChecks.count) tools."
				payload["ok"] = true
			} else {
				payload["ok"] = false
				payload["details"] =
					"Connected, but \(failed.count)/\(toolChecks.count) tool checks failed."
			}
		}

		PluginOutput.emit(payload)
	}

	private static func handleConnect(envelope: ConfigEnvelope) {
		guard SearchClient.hasApiKey(config: envelope.config) else {
			PluginOutput.emit([
				"ok": false,
				"reason":
					"Brave Search API key not found. Run `toby configure` to set your API key under Web Search.",
			])
		}

		do {
			try SearchClient.testConnection(config: envelope.config)
			PluginOutput.emit(["ok": true, "reason": "Web Search connected successfully."])
		} catch {
			PluginOutput.emit([
				"ok": false,
				"reason": "Web Search credentials are invalid: \(error.localizedDescription)",
			])
		}
	}

	private static func handleDisconnect() {
		PluginOutput.emit(["ok": true, "reason": "Web Search disconnected."])
	}

	private static func handleConfigShape() {
		PluginOutput.emit([
			"ok": true,
			"fields": [
				[
					"key": "apiKey",
					"label": "Brave Search API Key",
					"type": "string",
					"required": true,
					"masked": true,
				],
			],
		])
	}

	private static func handleConfigGet(envelope: ConfigEnvelope) {
		PluginOutput.emit(["ok": true, "config": envelope.config])
	}

	private static func handleConfigSet() {
		PluginOutput.emit(["ok": true, "reason": "Web Search config synced."])
	}

	private static func handleToolsList() {
		PluginOutput.emit(["ok": true, "tools": WebSearchTools.definitions])
	}

	private static func handleToolsExecute(raw: String) {
		guard !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
			let data = raw.data(using: .utf8),
			let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
		else {
			PluginOutput.emitError("Invalid JSON on stdin", code: "invalid_input", exitCode: 2)
		}

		let tool = stringValue(body["tool"]) ?? ""
		let input = body["input"] as? [String: Any] ?? [:]
		let config = body["config"] as? [String: Any] ?? [:]
		let dryRun = boolValue(body["dryRun"]) ?? false

		guard WebSearchTools.definitions.contains(where: { ($0["name"] as? String) == tool }) else {
			PluginOutput.emit(["ok": false, "error": "Unknown tool: \(tool)"])
		}

		switch WebSearchTools.execute(tool: tool, input: input, config: config, dryRun: dryRun) {
		case let .success(executed):
			var response: [String: Any] = ["ok": true, "result": executed.result]
			if !executed.appliedActions.isEmpty {
				response["appliedActions"] = executed.appliedActions
			}
			PluginOutput.emit(response)
		case let .failure(error):
			PluginOutput.emit(["ok": false, "error": error.message])
		}
	}

	private static func stringValue(_ value: Any?) -> String? {
		if let s = value as? String { return s }
		return nil
	}

	private static func boolValue(_ value: Any?) -> Bool? {
		if let b = value as? Bool { return b }
		if let n = value as? NSNumber { return n.boolValue }
		return nil
	}
}
