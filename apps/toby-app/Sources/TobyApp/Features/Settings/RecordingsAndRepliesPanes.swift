import SwiftUI
import TobyAI
import TobyCore

/// Reads and writes `config.json` values for the native panes.
@MainActor
enum NativeConfig {
	static var file: AppConfigFile { AppConfigFile(tobyDirectory: NativeRuntime.shared.paths.root) }

	static func bool(_ path: String, default fallback: Bool) -> Bool { file.value(path)?.boolValue ?? fallback }
	static func string(_ path: String) -> String { file.value(path)?.stringValue ?? "" }

	static func set(_ path: String, _ value: JSONValue?) -> String? {
		do { try file.set(path, value); return nil } catch { return error.localizedDescription }
	}
}

/// Persona picker shared by Recordings and Chat Replies ("" = default persona).
struct SettingsPersonaPicker: View {
	let title: String
	@Binding var selection: String
	@State private var personas: [PersonaOption] = []

	var body: some View {
		Picker(title, selection: $selection) {
			Text("Default persona").tag("")
			if !selection.isEmpty, !personas.contains(where: { $0.name == selection }) { Text(selection).tag(selection) }
			ForEach(personas) { Text($0.label).tag($0.name) }
		}
		.task { personas = (try? await TobyClient().listPersonas()) ?? [] }
	}
}

struct RecordingsSettingsPane: View {
	@State private var deleteAudio = NativeConfig.bool("listen.deleteAudioAfterTranscription", default: true)
	@State private var summaryPersona = NativeConfig.string("listen.summaryPersona")
	@State private var recordMic = NativeConfig.bool("listen.recordMic", default: true)
	@State private var recordSystem = NativeConfig.bool("listen.recordSystem", default: true)
	@State private var error: String?

	var body: some View {
		SwiftUI.Form {
			Section {
				Toggle("Record microphone", isOn: $recordMic)
					.disabled(recordMic && !recordSystem)
					.accessibilityIdentifier("recordings-record-mic")
				Toggle("Record system audio", isOn: $recordSystem)
					.disabled(recordSystem && !recordMic)
					.accessibilityIdentifier("recordings-record-system")
			} header: {
				Text("Sources")
			} footer: {
				Text("System audio captures other apps, such as meetings. At least one source stays on.")
			}
			Section {
				Toggle("Delete audio after transcription", isOn: $deleteAudio)
					.accessibilityIdentifier("recordings-delete-audio")
				SettingsPersonaPicker(title: "Summary persona", selection: $summaryPersona)
			} header: {
				Text("Recordings")
			} footer: {
				Text("Recordings are transcribed on this Mac with Apple speech recognition, then summarized and titled. Keeping audio lets you transcribe again later.")
			}
			if let error { Section { Text(error).foregroundStyle(.red) } }
		}
		.tobySettingsFormStyle()
		.onChange(of: deleteAudio) { _, value in error = NativeConfig.set("listen.deleteAudioAfterTranscription", .bool(value)) }
		.onChange(of: recordMic) { _, value in error = NativeConfig.set("listen.recordMic", .bool(value)) }
		.onChange(of: recordSystem) { _, value in error = NativeConfig.set("listen.recordSystem", .bool(value)) }
		.onChange(of: summaryPersona) { _, value in error = NativeConfig.set("listen.summaryPersona", value.isEmpty ? nil : .string(value)) }
	}
}

struct ChatRepliesSettingsPane: View {
	@State private var enabled = NativeConfig.bool("chatInbound.enabled", default: false)
	@State private var persona = NativeConfig.string("chatInbound.persona")
	@State private var slackReady = NativeRuntime.shared.slack.api.account().hasAccessToken
	@State private var error: String?

	var body: some View {
		SwiftUI.Form {
			Section {
				Toggle("Reply to Slack messages", isOn: $enabled)
					.disabled(!slackReady && !enabled)
					.accessibilityIdentifier("chat-replies-enabled")
				SettingsPersonaPicker(title: "Reply as", selection: $persona)
			} header: {
				Text("Slack")
			} footer: {
				Text(slackReady
					? "Toby answers direct messages and mentions in Slack while this Mac is awake. Replies need an app-level token (Sources → Slack)."
					: "Connect Slack under Sources first.")
			}
			if let error { Section { Text(error).foregroundStyle(.red) } }
		}
		.tobySettingsFormStyle()
		.onChange(of: enabled) { _, value in save(("chatInbound.enabled", .bool(value))) }
		.onChange(of: persona) { _, value in save(("chatInbound.persona", value.isEmpty ? nil : .string(value))) }
	}

	private func save(_ change: (String, JSONValue?)) {
		do {
			try NativeConfig.file.set([change, ("chatInbound.integration", .string("slack"))])
			error = nil
			NativeRuntime.shared.reloadChatReplies()
		} catch {
			self.error = error.localizedDescription
		}
	}
}
