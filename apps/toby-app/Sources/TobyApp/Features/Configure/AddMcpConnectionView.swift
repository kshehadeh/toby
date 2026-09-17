import SwiftUI

struct McpConnectionDraft: Identifiable, Equatable {
	var id = UUID()
	var displayName = ""
	var transport = "stdio"
	var command = ""
	var argumentsText = ""
	var cwd = ""
	var url = ""
	var authMethod = "none"
	var envJson = ""
	var headersJson = ""
	var bearerToken = ""
	var connectOnSave = true

	var canSave: Bool {
		guard !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
			return false
		}
		if transport == "stdio" {
			return !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
		}
		return !url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}

	func toRequest() -> CreateMcpConnectionRequest {
		let args = Self.parseArgs(argumentsText)
		return CreateMcpConnectionRequest(
			displayName: displayName.trimmingCharacters(in: .whitespacesAndNewlines),
			transport: transport,
			command: emptyToNil(command),
			args: args,
			cwd: emptyToNil(cwd),
			url: emptyToNil(url),
			authMethod: authMethod,
			envJson: emptyToNil(envJson),
			headersJson: emptyToNil(headersJson),
			bearerToken: emptyToNil(bearerToken),
			connect: connectOnSave
		)
	}

	private func emptyToNil(_ value: String) -> String? {
		let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed.isEmpty ? nil : trimmed
	}

	static func parseArgs(_ raw: String) -> [String]? {
		let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return nil }
		if let data = trimmed.data(using: .utf8),
			let parsed = try? JSONSerialization.jsonObject(with: data) as? [String]
		{
			return parsed
		}
		return trimmed.split(whereSeparator: \.isWhitespace).map(String.init)
	}
}

struct AddMcpConnectionView: View {
	@Bindable var store: ConfigureStore
	@Binding var draft: McpConnectionDraft?
	@State private var localError: String?

	private var canSave: Bool {
		draft?.canSave ?? false
	}

	var body: some View {
		EditorSheet(
			title: "Add MCP server",
			isSaving: store.isSaving,
			canSave: canSave,
			isDirty: draft != nil,
			errorMessage: localError ?? store.errorMessage,
			size: .regular,
			accessibilityIdentifier: "add-mcp-sheet",
			cancelAccessibilityIdentifier: "add-mcp-cancel",
			saveAccessibilityIdentifier: "add-mcp-save",
			onCancel: { draft = nil },
			onSave: { Task { await save() } }
		) {
			Form {
				Section("Server") {
					TextField("Display name", text: nameBinding)
					Picker("Transport", selection: transportBinding) {
						Text("Local command (stdio)").tag("stdio")
						Text("Streamable HTTP").tag("http")
						Text("Legacy SSE").tag("sse")
					}
					if (draft?.transport ?? "stdio") == "stdio" {
						TextField("Command", text: commandBinding)
						TextField("Arguments", text: argumentsBinding, prompt: Text("JSON array or space-separated"))
						TextField("Working directory", text: cwdBinding)
					} else {
						TextField("URL", text: urlBinding)
					}
				}
				Section("Authentication") {
					Picker("Method", selection: authBinding) {
						Text("None").tag("none")
						if (draft?.transport ?? "stdio") == "stdio" {
							Text("Environment variables").tag("env")
						} else {
							Text("Headers / bearer token").tag("headers")
							Text("OAuth 2.1").tag("oauth")
						}
					}
					if draft?.authMethod == "env" {
						TextField("Environment JSON", text: envBinding, axis: .vertical)
							.lineLimit(4...8)
					}
					if draft?.authMethod == "headers" {
						SecureField("Bearer token", text: bearerBinding)
						TextField("Headers JSON", text: headersBinding, axis: .vertical)
							.lineLimit(3...6)
					}
					if draft?.authMethod == "oauth" {
						Text("Toby will open a browser to authorize this server. The redirect URI is http://127.0.0.1:9879/mcp/callback.")
							.foregroundStyle(.secondary)
							.fixedSize(horizontal: false, vertical: true)
					}
				}
				Section {
					Toggle("Connect after saving", isOn: connectBinding)
				} footer: {
					Text("stdio runs a local command. Treat that command as software you trust. Secrets stay in credentials, not in config.json.")
				}
			}
			.tobySettingsFormStyle()
		}
	}

	private var nameBinding: Binding<String> {
		editorDraftFieldBinding($draft, \.displayName, fallback: McpConnectionDraft())
	}
	private var transportBinding: Binding<String> {
		editorDraftFieldBinding($draft, \.transport, fallback: McpConnectionDraft())
	}
	private var commandBinding: Binding<String> {
		editorDraftFieldBinding($draft, \.command, fallback: McpConnectionDraft())
	}
	private var argumentsBinding: Binding<String> {
		editorDraftFieldBinding($draft, \.argumentsText, fallback: McpConnectionDraft())
	}
	private var cwdBinding: Binding<String> {
		editorDraftFieldBinding($draft, \.cwd, fallback: McpConnectionDraft())
	}
	private var urlBinding: Binding<String> {
		editorDraftFieldBinding($draft, \.url, fallback: McpConnectionDraft())
	}
	private var authBinding: Binding<String> {
		editorDraftFieldBinding($draft, \.authMethod, fallback: McpConnectionDraft())
	}
	private var envBinding: Binding<String> {
		editorDraftFieldBinding($draft, \.envJson, fallback: McpConnectionDraft())
	}
	private var headersBinding: Binding<String> {
		editorDraftFieldBinding($draft, \.headersJson, fallback: McpConnectionDraft())
	}
	private var bearerBinding: Binding<String> {
		editorDraftFieldBinding($draft, \.bearerToken, fallback: McpConnectionDraft())
	}
	private var connectBinding: Binding<Bool> {
		editorDraftFieldBinding($draft, \.connectOnSave, fallback: McpConnectionDraft())
	}

	private func save() async {
		guard let current = draft else { return }
		localError = nil
		do {
			_ = try await store.createMcpConnection(current.toRequest())
			draft = nil
		} catch {
			localError = error.localizedDescription
		}
	}
}
