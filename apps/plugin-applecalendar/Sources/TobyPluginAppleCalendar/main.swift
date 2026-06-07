import Foundation
import TobyPluginAppleCalendarLib

@main
enum TobyPluginAppleCalendar {
	static func main() {
		let args = Array(CommandLine.arguments.dropFirst())
		let command = args.first
		let subcommand = args.count > 1 ? args[1] : nil
		let stdin = PluginOutput.readStdin()

		switch command {
		case "status":
			handleStatus(envelope: ConfigEnvelope.parse(stdin))
		case "connect":
			handleConnect(envelope: ConfigEnvelope.parse(stdin))
		case "disconnect":
			handleDisconnect()
		case "config":
			switch subcommand {
			case "shape":
				handleConfigShape()
			case "get":
				handleConfigGet(envelope: ConfigEnvelope.parse(stdin))
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
				handleToolsExecute(raw: stdin)
			default:
				PluginOutput.emitError("Unknown tools subcommand", code: "usage", exitCode: 2)
			}
		default:
			PluginOutput.emitError("Unknown command: \(command ?? "(none)")", code: "usage", exitCode: 2)
		}
	}

	private static func handleStatus(envelope: ConfigEnvelope) {
		let connected = PluginOutput.isConnected(state: envelope.state)
		var payload: [String: Any] = [
			"ok": true,
			"name": PluginConstants.name,
			"displayName": PluginConstants.displayName,
			"description": PluginConstants.description,
			"version": PluginConstants.version,
			"protocolVersion": PluginConstants.protocolVersion,
			"connected": connected,
			"capabilities": ["chat"],
			"providerCategories": ["calendar"],
			"resources": ["calendars", "events"],
			"chatModelPrep": Prompts.buildChatModelPrep(),
			"chatReadiness": Prompts.buildChatReadiness(state: envelope.state),
		]

		if !CalendarClient.isPlatformSupported {
			payload["connected"] = false
			payload["details"] = "Apple Calendar is only available on macOS."
			PluginOutput.emit(payload)
		}

		if connected {
			do {
				try CalendarClient.testConnection()
				payload["details"] = "Calendar.app reachable."
			} catch {
				payload["ok"] = false
				payload["details"] = "Connected, but Calendar.app check failed: \(error.localizedDescription)"
			}
		} else {
			payload["details"] =
				"Apple Calendar is not connected. Run `toby connect applecalendar` on this Mac first."
		}

		if envelope.validateTools && connected {
			let toolChecks = CalendarClient.validateTools()
			payload["tools"] = toolChecks
			let failed = toolChecks.filter { ($0["ok"] as? Bool) == false }
			if failed.isEmpty {
				payload["details"] = "Calendar.app reachable; validated \(toolChecks.count) tool check(s)."
				payload["ok"] = true
			} else {
				payload["ok"] = false
				payload["details"] =
					"Connected, but \(failed.count)/\(toolChecks.count) tool check(s) failed."
			}
		} else if connected && !envelope.validateTools {
			payload["details"] = "Apple Calendar is configured; full Calendar.app validation skipped."
		}

		PluginOutput.emit(payload)
	}

	private static func handleConnect(envelope: ConfigEnvelope) {
		_ = envelope
		guard CalendarClient.isPlatformSupported else {
			PluginOutput.emit(["ok": false, "reason": "Apple Calendar integration is only available on macOS."])
		}
		do {
			try CalendarClient.testConnection()
			PluginOutput.emit(["ok": true, "reason": "Apple Calendar connected successfully."])
		} catch {
			PluginOutput.emit(["ok": false, "reason": "Could not reach Calendar.app: \(error.localizedDescription)"])
		}
	}

	private static func handleDisconnect() {
		PluginOutput.emit(["ok": true, "reason": "Apple Calendar disconnected."])
	}

	private static func handleConfigShape() {
		PluginOutput.emit(["ok": true, "fields": []])
	}

	private static func handleConfigGet(envelope: ConfigEnvelope) {
		PluginOutput.emit(["ok": true, "config": envelope.config])
	}

	private static func handleConfigSet() {
		PluginOutput.emit(["ok": true])
	}

	private static func handleToolsList() {
		PluginOutput.emit(["ok": true, "tools": CalendarTools.definitions])
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
		let dryRun = boolValue(body["dryRun"]) ?? false
		let maxResults = intValue(body["maxResults"])

		guard CalendarTools.definitions.contains(where: { ($0["name"] as? String) == tool }) else {
			PluginOutput.emit(["ok": false, "error": "Unknown tool: \(tool)"])
		}

		switch CalendarTools.execute(tool: tool, input: input, dryRun: dryRun, maxResults: maxResults) {
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

	private static func intValue(_ value: Any?) -> Int? {
		if let n = value as? Int { return n }
		if let d = value as? Double { return Int(d) }
		if let n = value as? NSNumber { return n.intValue }
		return nil
	}
}
