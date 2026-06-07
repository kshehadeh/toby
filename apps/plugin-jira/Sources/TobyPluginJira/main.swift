import Foundation
import TobyPluginJiraLib

@main
enum TobyPluginJira {
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
			"providerCategories": ["work_tracker"],
			"resources": ["issues", "projects"],
			"chatModelPrep": Prompts.buildChatModelPrep(),
			"chatReadiness": Prompts.buildChatReadiness(config: envelope.config, state: envelope.state),
		]

		if connected && JiraClient.hasCredentials(config: envelope.config) {
			do {
				try JiraClient.testConnection(config: envelope.config)
				payload["details"] = "Jira API reachable and authenticated."
			} catch {
				payload["ok"] = false
				payload["details"] = "Connected, but Jira API check failed: \(error.localizedDescription)"
			}
		} else if JiraClient.hasCredentials(config: envelope.config) && !connected {
			payload["details"] =
				"Jira credentials configured. Run `toby connect jira` to mark connected, or use chat directly."
		} else {
			payload["details"] =
				"Jira is not connected. Run `toby connect jira` after configuring your credentials."
		}

		if envelope.validateTools && JiraClient.hasCredentials(config: envelope.config) {
			let toolChecks = JiraClient.validateTools()
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
		guard JiraClient.hasCredentials(config: envelope.config) else {
			PluginOutput.emit([
				"ok": false,
				"reason":
					"Jira credentials not found. Run `toby configure` to set your domain, email, and API token.",
			])
		}

		do {
			try JiraClient.testConnection(config: envelope.config)
			PluginOutput.emit(["ok": true, "reason": "Jira connected successfully."])
		} catch {
			PluginOutput.emit([
				"ok": false,
				"reason": "Jira credentials are invalid: \(error.localizedDescription)",
			])
		}
	}

	private static func handleDisconnect() {
		PluginOutput.emit(["ok": true, "reason": "Jira disconnected."])
	}

	private static func handleConfigShape() {
		PluginOutput.emit([
			"ok": true,
			"fields": [
				[
					"key": "jira.domain",
					"label": "Atlassian Domain",
					"type": "string",
					"required": true,
				],
				[
					"key": "jira.email",
					"label": "Email",
					"type": "string",
					"required": true,
				],
				[
					"key": "jira.apiToken",
					"label": "API Token",
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
		PluginOutput.emit(["ok": true, "reason": "Jira config synced."])
	}

	private static func handleToolsList() {
		PluginOutput.emit(["ok": true, "tools": JiraTools.definitions])
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

		guard JiraTools.definitions.contains(where: { ($0["name"] as? String) == tool }) else {
			PluginOutput.emit(["ok": false, "error": "Unknown tool: \(tool)"])
		}

		switch JiraTools.execute(tool: tool, input: input, config: config, dryRun: dryRun) {
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
