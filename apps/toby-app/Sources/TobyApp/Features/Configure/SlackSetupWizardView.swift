import AppKit
import SwiftUI

struct SlackSetupWizardView: View {
    var onCompleted: (() -> Void)?
    var onDismiss: () -> Void
    @State private var store: SlackSetupStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var focusedField: String?

    init(store: SlackSetupStore? = nil, onCompleted: (() -> Void)? = nil, onDismiss: @escaping () -> Void) {
        self.onCompleted = onCompleted
        self.onDismiss = onDismiss
        _store = State(initialValue: store ?? SlackSetupStore())
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 44) {
                introduction.frame(width: 270, alignment: .leading)
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        page.disabled(store.isBusy)
                        if let error = store.error { InlineStatusMessage(message: error, tone: .error) }
                        if store.isSubmitting {
                            ProgressView(store.step == .search ? "Finish authorizing in your browser…" : "Checking Slack…")
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 16)
                }
                .id(store.step)
                .transition(.opacity)
            }
            .padding(36)
            .frame(maxHeight: .infinity)
            Divider()
            footer.padding(20)
        }
        .frame(width: 860, height: 580)
        .background(SettingsDesign.canvasBackground)
        .tint(AppTheme.accent)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: store.step)
        .interactiveDismissDisabled(store.isSubmitting)
        .task { await store.load() }
        .task(id: store.monitoringID) {
            guard store.step == .verify, store.testStartedAt != nil else { return }
            for _ in 0..<120 {
                guard !Task.isCancelled, store.step == .verify, !store.testVerified else { return }
                await store.refreshInbound()
                try? await Task.sleep(for: .seconds(1))
            }
            if !Task.isCancelled { store.monitoringTimedOut = true }
        }
        .onDisappear { store.cancel() }
        .onChange(of: store.toolsValidated) { _, valid in if valid { onCompleted?() } }
        .onChange(of: store.step) { _, step in
            focusedField = step == .bot ? "botToken" : (step == .socket ? "appToken" : nil)
            if step == .ready { onCompleted?() }
        }
        .accessibilityIdentifier("slack-setup-wizard")
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: store.step == .ready ? "checkmark.circle" : "bubble.left.and.bubble.right")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(AppTheme.accent).accessibilityHidden(true)
            Text("Set up Toby").font(.subheadline).foregroundStyle(AppTheme.secondaryText)
            Text(store.step.title).font(.system(size: 26, weight: .semibold))
                .foregroundStyle(AppTheme.primaryText).fixedSize(horizontal: false, vertical: true)
            Text(store.step.explanation).foregroundStyle(AppTheme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var page: some View {
        @Bindable var store = store
        switch store.step {
        case .welcome:
            Toggle("Receive DMs and @mentions in Toby", isOn: $store.inbound)
            Text(store.inbound ? "Toby will ask for a bot token and a Socket Mode app token." : "Tools only: send messages from Toby without enabling an inbound listener.")
                .foregroundStyle(AppTheme.secondaryText)
            Toggle("Use an existing Slack app", isOn: $store.existingApp)
            Text("Message search uses an optional user sign-in. Your Slack password stays in your browser.")
                .foregroundStyle(AppTheme.secondaryText)
        case .app:
            if store.existingApp {
                Text("Keep your existing app. Check its permissions and event subscriptions against Toby’s manifest before reinstalling.")
                Link("Open Slack app settings", destination: URL(string: "https://api.slack.com/apps")!)
            } else if let url = store.creationURL {
                Link("Create Toby app in Slack", destination: url).buttonStyle(.borderedProminent)
                Text("The app is preconfigured. Select your workspace, review the permissions, and create it. Return here when finished.")
                    .foregroundStyle(AppTheme.secondaryText)
            } else {
                Text("Toby couldn’t load the app creation link.")
                Button("Reload setup instructions") { Task { await store.load() } }
            }
            if let manifest = store.manifest {
                Button("Copy app manifest") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(manifest, forType: .string)
                }
                Text("Fallback: create an app “From a manifest” and paste the copied JSON. The manifest includes scopes, events, Socket Mode, and DM settings.")
                    .font(.callout).foregroundStyle(AppTheme.secondaryText)
            }
        case .bot:
            Text("1. Open your app’s OAuth & Permissions page.")
            Text("2. Click Install to Workspace and approve access.")
            Text("3. Copy the Bot User OAuth Token (xoxb-…).")
            SecureField(store.hasBot && store.botToken.isEmpty ? "Saved bot token; paste to replace" : "Bot token (xoxb-…)", text: $store.botToken)
                .textFieldStyle(.roundedBorder).focused($focusedField, equals: "botToken")
                .accessibilityLabel("Bot token").accessibilityIdentifier("slack-setup-bot-token")
            appSettingsLink
        case .socket:
            Text("1. Basic Information → App-Level Tokens → Generate Token and Scopes.")
            Text("2. Name it “toby-socket” and add connections:write.")
            Text("3. Generate and copy the xapp-… token. Confirm Socket Mode is enabled.")
            SecureField(store.hasAppToken && store.appToken.isEmpty ? "Saved app token; paste to replace" : "App token (xapp-…)", text: $store.appToken)
                .textFieldStyle(.roundedBorder).focused($focusedField, equals: "appToken")
                .accessibilityLabel("Socket Mode app token").accessibilityIdentifier("slack-setup-app-token")
            appSettingsLink
        case .search:
            if let team = store.teamName { Label("Bot connected to \(team)", systemImage: "checkmark.circle") }
            if store.hasUserTools {
                Text("User authorization is already saved. Continue, or authorize again to update permissions.")
                    .foregroundStyle(AppTheme.secondaryText)
            }
            Text("Copy the Client ID from Basic Information. Under OAuth & Permissions, enable PKCE and add this redirect URL:")
            Text(store.redirectURI).font(.callout.monospaced()).textSelection(.enabled)
            TextField("Client ID", text: $store.clientId).textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("slack-setup-client-id")
            Text("Toby requests user access for search and other Slack tools. No client secret is needed.")
                .foregroundStyle(AppTheme.secondaryText)
            appSettingsLink
            Button(store.hasUserTools ? "Continue with saved authorization" : "Skip message search") {
                store.go(to: store.inbound ? .verify : .ready)
            }.buttonStyle(.link)
        case .verify:
            verification
        case .ready:
            if let team = store.teamName { Text(team).font(.headline) }
            Label("Slack tools connected", systemImage: "checkmark.circle")
            if store.hasUserTools { Label("User authorization saved", systemImage: "person.crop.circle.badge.checkmark") }
            if store.inbound {
                Label(store.testVerified ? "Inbound message and reply verified" : "Inbound message test not completed", systemImage: store.testVerified ? "checkmark.circle" : "exclamationmark.circle")
                Text("Inbound runs while Toby’s background service is available on this Mac.").foregroundStyle(AppTheme.secondaryText)
            }
            Text("Try asking Toby to send a Slack message.").foregroundStyle(AppTheme.secondaryText)
        }
    }

    @ViewBuilder private var verification: some View {
        @Bindable var store = store
        if store.testStartedAt == nil {
            Picker("Persona for inbound replies", selection: $store.persona) {
                Text("Default persona").tag("")
                ForEach(store.personas) { Text($0.label).tag($0.name) }
            }
            if let active = store.activeIntegration, active != "slack" {
                Text("Enabling Slack inbound will replace \(active) as the active inbound integration.")
                    .foregroundStyle(AppTheme.secondaryText)
            }
            Text("No message is sent by this check. After enabling inbound, send the test message yourself in Slack.")
                .foregroundStyle(AppTheme.secondaryText)
        } else {
            Label(store.inboundStatus?.integration == "slack" ? (store.inboundStatus?.connectionLabel ?? "Connecting…") : "Waiting for Slack listener…", systemImage: store.inboundStatus?.isConnected == true ? "checkmark.circle" : "antenna.radiowaves.left.and.right")
            if let detail = store.inboundStatus?.disconnectExplanation {
                Text(detail).foregroundStyle(AppTheme.secondaryText)
            }
            if store.testVerified {
                InlineStatusMessage(message: "Toby received a message and posted a reply in Slack.", tone: .success)
            } else {
                Text("Send “hello” in a DM to Toby, or invite it to a channel and @mention it. Keep this wizard open until Toby replies.")
                Text("Connected transport alone does not verify your event subscriptions.")
                    .font(.callout).foregroundStyle(AppTheme.secondaryText)
            }
            if store.monitoringTimedOut {
                Text("The message check paused. You can check again or finish without verifying messages.")
                    .foregroundStyle(AppTheme.secondaryText)
                Button("Check again") { store.resumeMonitoring() }
            }
            Button("Reconnect inbound") { store.enableInbound() }
        }
        if !store.testVerified {
            Button("Finish without the message test") { store.go(to: .ready) }.buttonStyle(.link)
        }
    }

    private var appSettingsLink: some View {
        Link("Open Slack app settings", destination: URL(string: "https://api.slack.com/apps")!)
    }

    private var footer: some View {
        HStack {
            Button(store.isSubmitting ? "Cancel setup" : "Close", role: .cancel) { store.cancel(); onDismiss() }
                .keyboardShortcut(.cancelAction)
            if store.step != .welcome && store.step != .ready {
                Button("Back") {
                    if store.step == .search { store.go(to: store.inbound ? .socket : .bot) }
                    else if let previous = SlackSetupStore.Step(rawValue: store.step.rawValue - 1) { store.go(to: previous) }
                }.disabled(store.isBusy)
            }
            Spacer()
            Button(primaryTitle, action: advance)
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(primaryDisabled).accessibilityIdentifier("slack-setup-next")
        }
    }

    private var primaryTitle: String {
        switch store.step {
        case .welcome: "Get started"
        case .app: "Continue"
        case .bot: store.inbound ? "Continue" : "Check and connect"
        case .socket: "Check and connect"
        case .search: "Authorize message search"
        case .verify: store.testVerified ? "Finish setup" : "Enable inbound"
        case .ready: "Done"
        }
    }
    private var primaryDisabled: Bool {
        if store.isBusy { return true }
        switch store.step {
        case .bot: return !store.hasBot
        case .socket: return !store.canValidateBot
        case .search: return !store.canAuthorize
        case .verify: return store.testStartedAt != nil && !store.testVerified
        default: return false
        }
    }
    private func advance() {
        switch store.step {
        case .welcome: store.go(to: .app)
        case .app: store.go(to: .bot)
        case .bot: if store.inbound { store.go(to: .socket) } else { store.connectBot() }
        case .socket: store.connectBot()
        case .search: store.authorizeSearch()
        case .verify: if store.testVerified { store.go(to: .ready) } else { store.enableInbound() }
        case .ready: onCompleted?(); onDismiss()
        }
    }
}
