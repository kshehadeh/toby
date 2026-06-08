import Foundation
import TobyPluginWhisperLib

@main
enum TobyPluginWhisper {
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
		case "setup":
			handleSetup(envelope: ConfigEnvelope.parse(PluginOutput.readStdin()))
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
		let resolved = WhisperConfig.resolve(config: envelope.config)
		let ready = resolved.isReady
		var payload: [String: Any] = [
			"ok": ready,
			"name": PluginConstants.name,
			"displayName": PluginConstants.displayName,
			"description": PluginConstants.description,
			"version": PluginConstants.version,
			"protocolVersion": PluginConstants.protocolVersion,
			"connected": PluginOutput.isConnected(config: envelope.config, state: envelope.state),
			"capabilities": ["transcription"],
			"providerCategories": ["transcription"],
			"resources": ["local speech-to-text"],
			"setupAvailable": true,
			"setupDescription": "Download the default whisper.cpp transcription model",
			"details": ready
				? "Whisper transcription ready."
				: "Whisper is not ready. Run `toby plugins setup whisper`.",
		]

		if envelope.validateTools && ready {
			payload["tools"] = [
				[
					"tool": "doTranscription",
					"ok": true,
					"details": "doTranscription is available",
				],
			]
		}

		PluginOutput.emit(payload)
	}

	private static func handleConnect(envelope: ConfigEnvelope) {
		let resolved = WhisperConfig.resolve(config: envelope.config)
		guard resolved.isReady else {
			PluginOutput.emit([
				"ok": false,
				"reason": "Whisper is not ready. Run `toby plugins setup whisper` first.",
			])
		}
		PluginOutput.emit(["ok": true, "reason": "Whisper transcription connected."])
	}

	private static func handleDisconnect() {
		PluginOutput.emit(["ok": true, "reason": "Whisper transcription disconnected."])
	}

	private static func handleSetup(envelope: ConfigEnvelope) {
		do {
			let forceModel = envelope.config["forceModel"] as? Bool ?? false
			let configPatch = try WhisperSetup.run(config: envelope.config, forceModel: forceModel)
			PluginOutput.emit([
				"ok": true,
				"reason": "Whisper setup complete.",
				"config": configPatch,
			])
		} catch {
			PluginOutput.emit([
				"ok": false,
				"reason": error.localizedDescription,
			])
		}
	}

	private static func handleConfigShape() {
		PluginOutput.emit([
			"ok": true,
			"fields": [
				[
					"key": "whisper.modelPath",
					"label": "Whisper model path",
					"type": "string",
				],
				[
					"key": "whisper.language",
					"label": "Transcription language",
					"type": "string",
				],
			],
		])
	}

	private static func handleConfigGet(envelope: ConfigEnvelope) {
		let resolved = WhisperConfig.resolve(config: envelope.config)
		PluginOutput.emit([
			"ok": true,
			"config": [
				"modelPath": resolved.modelPath,
				"language": resolved.language,
			],
		])
	}

	private static func handleConfigSet() {
		PluginOutput.emit(["ok": true, "reason": "Whisper config synced."])
	}

	private static func handleToolsList() {
		PluginOutput.emit(["ok": true, "tools": WhisperTools.definitions])
	}

	private static func handleToolsExecute(raw: String) {
		guard !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
			let data = raw.data(using: .utf8),
			let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
		else {
			PluginOutput.emitError("Invalid JSON on stdin", code: "invalid_input", exitCode: 2)
		}

		let tool = body["tool"] as? String ?? ""
		let input = body["input"] as? [String: Any] ?? [:]
		let config = body["config"] as? [String: Any] ?? [:]
		let dryRun = body["dryRun"] as? Bool ?? false

		switch WhisperTools.execute(tool: tool, input: input, config: config, dryRun: dryRun) {
		case let .success(executed):
			var response: [String: Any] = ["ok": true, "result": executed.result]
			if !executed.appliedActions.isEmpty {
				response["appliedActions"] = executed.appliedActions
			}
			PluginOutput.emit(response)
		case let .failure(.message(message)):
			PluginOutput.emit(["ok": false, "error": message])
		}
	}
}
