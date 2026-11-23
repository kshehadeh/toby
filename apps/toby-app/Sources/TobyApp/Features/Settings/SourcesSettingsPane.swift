import AppKit
import SwiftUI
import TobyCore

/// Built-in sources: Mail (IMAP/SMTP) and Slack. Calendar, Reminders, and
/// Contacts need only macOS permission (see Permissions).
/// (No `@Observable` here: TobyCore's `Observation` type shadows the macro's module.)
@MainActor
struct SourcesState {
	var mailAddress: String?
	var slackTeam: String?
	var slackConnected = false
	var error: String?

	mutating func refresh() {
		let mail = try? NativeRuntime.shared.mail()
		mailAddress = mail?.account().map { $0.fromAddress.isEmpty ? $0.imap.username : $0.fromAddress }
		let account = NativeRuntime.shared.slack.api.account()
		slackConnected = account.hasAccessToken
		slackTeam = account.values["teamName"]?.nilIfBlank
	}

	mutating func disconnectMail() {
		do { try NativeRuntime.shared.mail().disconnect() } catch { self.error = error.localizedDescription }
		refresh()
	}

	mutating func disconnectSlack() {
		let api = NativeRuntime.shared.slack.api
		do { try api.save(Dictionary(uniqueKeysWithValues: SlackAccount.fields.map { ($0, "") })) } catch { self.error = error.localizedDescription }
		NativeRuntime.shared.reloadChatReplies()
		refresh()
	}
}

struct SourcesSettingsPane: View {
	@State private var model = SourcesState()
	@State private var showingMailSetup = false
	@State private var showingSlackSetup = false

	var body: some View {
		SwiftUI.Form {
			Section {
				sourceRow(title: "Mail", systemImage: "envelope", detail: model.mailAddress ?? "Not connected", connected: model.mailAddress != nil,
				          connect: { showingMailSetup = true }, disconnect: { model.disconnectMail() })
				sourceRow(title: "Slack", systemImage: "number", detail: model.slackConnected ? (model.slackTeam ?? "Connected") : "Not connected",
				          connected: model.slackConnected, connect: { showingSlackSetup = true }, disconnect: { model.disconnectSlack() })
			} header: {
				Text("Accounts")
			} footer: {
				Text("Mail and Slack feed your Home, follow-ups, and chats. Credentials stay in your Keychain.")
			}
			Section {
				Text("Calendar, Reminders, and Contacts come from the macOS apps on this Mac. Grant access under Permissions.")
					.foregroundStyle(.secondary)
			} header: {
				Text("Apple Apps")
			}
			if let error = model.error {
				Section { Text(error).foregroundStyle(.red) }
			}
		}
		.tobySettingsFormStyle()
		.onAppear { model.refresh() }
		.sheet(isPresented: $showingMailSetup) {
			EmailSetupWizardView(onCompleted: { model.refresh() }, onDismiss: { showingMailSetup = false })
		}
		.sheet(isPresented: $showingSlackSetup) {
			SlackConnectSheet(onConnected: { model.refresh() }, onDismiss: { showingSlackSetup = false })
		}
	}

	private func sourceRow(title: String, systemImage: String, detail: String, connected: Bool, connect: @escaping () -> Void, disconnect: @escaping () -> Void) -> some View {
		HStack {
			Label {
				VStack(alignment: .leading, spacing: 2) {
					Text(title)
					Text(detail).font(.caption).foregroundStyle(.secondary)
				}
			} icon: {
				Image(systemName: systemImage)
			}
			Spacer()
			if connected {
				Button("Disconnect", role: .destructive, action: disconnect)
					.accessibilityIdentifier("sources-\(title.lowercased())-disconnect")
			} else {
				Button("Connect…", action: connect)
					.accessibilityIdentifier("sources-\(title.lowercased())-connect")
			}
		}
	}
}

/// Connect Slack with your Slack app: OAuth in the browser (user token) or a
/// pasted bot token. An app-level token enables replies over Socket Mode.
struct SlackConnectSheet: View {
	enum Method: String, CaseIterable, Identifiable {
		case oauth = "Sign in with Slack"
		case botToken = "Bot token"
		var id: String { rawValue }
	}

	var onConnected: () -> Void
	var onDismiss: () -> Void

	@State private var method: Method = .oauth
	@State private var clientID = ""
	@State private var clientSecret = ""
	@State private var botToken = ""
	@State private var appToken = ""
	@State private var working = false
	@State private var error: String?
	@State private var signIn: SlackSignIn?

	var body: some View {
		VStack(alignment: .leading, spacing: 16) {
			Text("Connect Slack").font(.title2.bold())
			Picker("Method", selection: $method) {
				ForEach(Method.allCases) { Text($0.rawValue).tag($0) }
			}
			.pickerStyle(.segmented)
			.labelsHidden()
			SwiftUI.Form {
				switch method {
				case .oauth:
					TextField("Client ID", text: $clientID)
					SecureField("Client secret (optional)", text: $clientSecret)
					Text("Register \(SlackSignIn.defaultRedirectURI) as a redirect URL and enable PKCE in your Slack app.")
						.font(.caption).foregroundStyle(.secondary)
				case .botToken:
					SecureField("Bot token (xoxb-…)", text: $botToken)
				}
				Section {
					if method == .oauth {
						SecureField("Bot token (xoxb-…)", text: $botToken)
					}
					SecureField("App-level token (xapp-…)", text: $appToken)
				} header: {
					Text("Chat replies (optional)")
				} footer: {
					Text("Toby answers Slack messages over Socket Mode, which needs your app's bot token and an app-level token with connections:write.")
				}
			}
			.formStyle(.grouped)
			if let error { Text(error).foregroundStyle(.red).font(.callout) }
			HStack {
				if working { ProgressView().controlSize(.small) }
				Spacer()
				Button("Cancel") { signIn?.cancel(); onDismiss() }
					.keyboardShortcut(.cancelAction)
				Button(method == .oauth ? "Continue in Browser" : "Connect") { Task { await connect() } }
					.keyboardShortcut(.defaultAction)
					.disabled(working || (method == .oauth ? clientID.isBlank : botToken.isBlank))
			}
		}
		.padding(20)
		.frame(width: 480)
		.onAppear {
			let account = NativeRuntime.shared.slack.api.account()
			clientID = account.values["clientId"] ?? ""
		}
	}

	private func connect() async {
		working = true
		error = nil
		defer { working = false }
		let api = NativeRuntime.shared.slack.api
		do {
			var patch: [String: String]
			switch method {
			case .oauth:
				let session = try SlackSignIn(clientID: clientID.trimmed, clientSecret: clientSecret.trimmed, redirectURI: nil)
				signIn = session
				NSWorkspace.shared.open(session.authorizationURL)
				patch = try await session.waitForTokens()
				patch["clientId"] = clientID.trimmed
				if !clientSecret.isBlank { patch["clientSecret"] = clientSecret.trimmed }
			case .botToken:
				patch = ["authMethod": "bot_token", "botToken": botToken.trimmed]
			}
			if !appToken.isBlank { patch["appToken"] = appToken.trimmed }
			if method == .oauth, !botToken.isBlank { patch["botToken"] = botToken.trimmed }
			try api.save(patch)
			let identity = try await api.call("auth.test")
			try api.save(["teamName": identity["team"]?.stringValue ?? patch["teamName"] ?? "", "teamId": identity["team_id"]?.stringValue ?? patch["teamId"] ?? ""])
			NativeRuntime.shared.reloadChatReplies()
			onConnected()
			onDismiss()
		} catch is CancellationError {
			// Dismissed while waiting for the browser.
		} catch {
			self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
		}
	}
}

private extension String {
	var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
	var isBlank: Bool { trimmed.isEmpty }
	var nilIfBlank: String? { isBlank ? nil : self }
}
