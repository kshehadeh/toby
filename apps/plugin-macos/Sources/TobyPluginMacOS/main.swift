import Foundation
import TobyPluginMacOSLib

@main
enum TobyPluginMacOS {
	static func main() {
		let args = Array(CommandLine.arguments.dropFirst())
		let command = args.first
		let subcommand = args.count > 1 ? args[1] : nil

		switch command {
		case "status":
			handleStatus(envelope: ConfigEnvelope.parse(PluginOutput.readStdin()))
		case "connect":
			handleConnect()
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
		case "setup":
			handleSetup()
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
			"resources": ["wifi", "bluetooth", "battery", "audio", "powermode", "display", "clipboard", "focus"],
			"chatModelPrep": Prompts.buildChatModelPrep(),
			"chatReadiness": Prompts.buildChatReadiness(state: envelope.state),
		]

		if SystemClient.isPlatformSupported {
			payload["setupAvailable"] = true
			payload["setupDescription"] = "Install bundled Focus shortcuts for Toby"
		}

		if !SystemClient.isPlatformSupported {
			payload["connected"] = false
			payload["details"] = "macOS integration is only available on macOS."
			PluginOutput.emit(payload)
		}

		if connected {
			do {
				try SystemClient.smokeTest()
				payload["details"] = "macOS subsystem reachable."
			} catch {
				payload["ok"] = false
				payload["details"] = "Connected, but subsystem check failed: \(error.localizedDescription)"
			}
		} else {
			payload["details"] = "macOS integration is not connected. Run `toby connect macos` on this Mac first."
		}

		if envelope.validateTools && connected {
			let toolChecks = SystemClient.validateSubtools()
			payload["tools"] = toolChecks
			let failed = toolChecks.filter { ($0["ok"] as? Bool) == false }
			if failed.isEmpty {
				payload["details"] = "Subsystem probes reachable; validated \(toolChecks.count) tool check(s)."
				payload["ok"] = true
			} else {
				payload["ok"] = false
				payload["details"] = "Connected, but \(failed.count)/\(toolChecks.count) tool check(s) failed."
			}
		} else if connected && !envelope.validateTools {
			payload["details"] = "macOS integration is configured; full subsystem probes skipped."
		}

		PluginOutput.emit(payload)
	}

	private static func handleConnect() {
		guard SystemClient.isPlatformSupported else {
			PluginOutput.emit(["ok": false, "reason": "macOS integration is only available on macOS."])
		}
		do {
			try SystemClient.smokeTest()
			PluginOutput.emit(["ok": true, "reason": "macOS integration connected successfully."])
		} catch {
			PluginOutput.emit(["ok": false, "reason": "macOS subsystem check failed: \(error.localizedDescription)"])
		}
	}

	private static func handleDisconnect() {
		PluginOutput.emit(["ok": true, "reason": "macOS integration disconnected."])
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
		PluginOutput.emit(["ok": true, "tools": MacOSTools.definitions])
	}

	private static func handleSetup() {
		do {
			let actions = try SetupCommands.run()
			PluginOutput.emit(["ok": true, "actions": actions])
		} catch {
			PluginOutput.emit(["ok": false, "error": error.localizedDescription])
		}
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

		guard MacOSTools.definitions.contains(where: { ($0["name"] as? String) == tool }) else {
			PluginOutput.emit(["ok": false, "error": "Unknown tool: \(tool)"])
		}

		switch MacOSTools.execute(tool: tool, input: input, dryRun: dryRun) {
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
