import AppKit
import SwiftUI

/// Shared guided setup, retaining the existing entry point for Settings callers.
struct VercelAIGatewaySetupWizardView: View {
    var onCompleted: (() -> Void)?
    var onStartChat: (() -> Void)?
    var onDismiss: () -> Void
    @State private var store: AISetupStore
    @State private var showDetails = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var focusedField: String?

    init(providerId: String? = nil, store: AISetupStore? = nil, onCompleted: (() -> Void)? = nil, onStartChat: (() -> Void)? = nil, onDismiss: @escaping () -> Void) {
        self.onCompleted = onCompleted
        self.onStartChat = onStartChat
        self.onDismiss = onDismiss
        _store = State(initialValue: store ?? AISetupStore(providerId: providerId ?? "openrouter", restoreProvider: providerId == nil))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 44) {
                introduction
                    .frame(width: 270, alignment: .leading)
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        page.disabled(store.isBusy)
                        if let error = store.error {
                            InlineStatusMessage(message: error, tone: .error)
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
        .interactiveDismissDisabled(store.isBusy)
        .task(id: store.providerId) {
            if store.guide?.providerId != store.providerId { await store.loadGuide() }
        }
        .onDisappear { store.oauth.cancel() }
        .onChange(of: store.oauth.phase) { _, phase in
            if phase == .completed, let response = store.oauth.result {
                store.acceptConnection(response)
                onCompleted?()
            }
        }
        .onChange(of: store.step) { _, step in
            if step == .connect { focusedField = store.guide?.fields.first?.key }
        }
        .accessibilityIdentifier("ai-provider-setup-wizard")
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: store.step == .ready ? "checkmark.circle" : "sparkles")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(AppTheme.accent)
                .accessibilityHidden(true)
            Text("Set up Toby").font(.subheadline).foregroundStyle(AppTheme.secondaryText)
            Text(store.step.title).font(.system(size: 26, weight: .semibold))
                .foregroundStyle(AppTheme.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            Text(store.step == .connect && store.usesBrowserSignIn
                 ? "Sign in to OpenRouter in your browser and approve the connection. Toby will take care of the rest."
                 : store.step.explanation).font(.body).foregroundStyle(AppTheme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var page: some View {
        switch store.step {
        case .welcome:
            VStack(alignment: .leading, spacing: 24) {
                overviewRow("person.crop.circle", "Create an account", "One service for Toby’s AI features.")
                overviewRow("key", "Connect it to Toby", "Sign in securely through your browser.")
                overviewRow("bubble.left.and.bubble.right", "Try your first message", "Toby checks that everything works.")
                Divider()
                Text("AI usage is billed through your provider account. We’ll show you where to review pricing before you connect.")
                    .foregroundStyle(AppTheme.secondaryText)
                Button("I already have an API key") { store.useManualKey = true; store.go(to: .connect) }
                    .buttonStyle(.link)
                Button("Use another AI service…") {
                    onDismiss()
                    NotificationCenter.default.post(name: .openSettingsWindow, object: "ai")
                }.buttonStyle(.link)
            }
        case .account:
            providerPicker
            Text(store.providerId == "openrouter"
                 ? "Recommended: connect OpenRouter in your browser. No key to copy or paste."
                 : "Vercel AI Gateway connects Toby to multiple AI services using an API key.")
                .foregroundStyle(AppTheme.secondaryText)
            if store.usesBrowserSignIn {
                Text("You can create an account or sign in when your browser opens. OpenRouter may show a localhost address for this Mac on the approval screen.")
                    .foregroundStyle(AppTheme.secondaryText)
                Text("After you approve, Toby sends a short test message that may use a small amount of credit, then saves your connection securely.")
                    .font(.callout).foregroundStyle(AppTheme.secondaryText)
            } else {
                guideLink(step: "account", fallback: "Open account page")
                Text("Create an account or sign in in your browser, then return here. Your place in setup will be kept.")
                    .foregroundStyle(AppTheme.secondaryText)
            }
            pricing
        case .connect:
            providerPicker
            if store.usesBrowserSignIn {
                browserConnection
            } else {
                if store.providerId == "openrouter" {
                    Button("Sign in with your browser instead") {
                        store.fields = [:]
                        store.useManualKey = false
                    }.buttonStyle(.link)
                }
                guideLink(step: "create-key", fallback: "Create a key")
                Text("Name the key “Toby”, then copy it. You may only be able to see the key once.")
                    .foregroundStyle(AppTheme.secondaryText)
                if let guide = store.guide {
                    ForEach(guide.fields) { field in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(field.label).font(.headline)
                            HStack {
                                credentialField(field)
                                Button("Paste") {
                                    if let value = NSPasteboard.general.string(forType: .string) {
                                        store.fields[field.key] = value.trimmingCharacters(in: .whitespacesAndNewlines)
                                    }
                                }
                                .accessibilityLabel("Paste \(field.label)")
                            }
                        }
                    }
                }
                Text("Connect and test sends a short test message that may use a small amount of credit. Your key is saved securely on this Mac after the test succeeds.")
                    .font(.callout).foregroundStyle(AppTheme.secondaryText)
            }
            DisclosureGroup("What gets sent?") {
                Text("The connection test sends only a short sample message. When you use Toby, your messages and relevant context are sent through your chosen service to the AI model.")
                    .font(.callout).foregroundStyle(AppTheme.secondaryText).padding(.top, 8)
            }
            pricing
        case .ready:
            Label("Connection tested", systemImage: "checkmark.circle.fill")
                .font(.headline).foregroundStyle(AppTheme.accent)
            Text(store.result?.details?.testResponse ?? "")
                .font(.title3).textSelection(.enabled)
            Text("Try asking Toby: “Help me plan my day.”")
                .foregroundStyle(AppTheme.secondaryText)
            DisclosureGroup("Connection details", isExpanded: $showDetails) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(store.guide?.displayName ?? store.providerId)
                    Text(store.result?.model ?? "")
                    Text("You can change your provider and model in Settings.")
                }.font(.callout).foregroundStyle(AppTheme.secondaryText).padding(.top, 8)
            }
        }
    }

    private var browserConnection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(store.oauth.phase == .testing || store.oauth.phase == .authorized ? "Account connected" : (store.oauth.isActive ? "Finish connecting in your browser" : "Connect without copying a key"))
                .font(.headline)
            Text("Sign in or create an OpenRouter account, then approve access. Toby will test the connection automatically. The short test may use a small amount of credit.")
                .foregroundStyle(AppTheme.secondaryText)
            if let url = store.oauth.authorizationURL, store.oauth.phase == .waiting {
                Link("Open browser again ↗", destination: url)
            }
            if let error = store.oauth.error {
                InlineStatusMessage(message: error, tone: .error)
            }
            if store.oauth.isActive && !store.oauth.isTesting {
                Button(store.oauth.phase == .authorized ? "Start sign-in again" : "Cancel sign-in") {
                    store.oauth.cancel()
                }
            }
            if !store.oauth.isTesting {
                Button("Paste an existing key instead") {
                    store.oauth.cancel()
                    store.useManualKey = true
                }.buttonStyle(.link)
            }
        }
        .accessibilityIdentifier("ai-setup-browser-connection")
    }

    private var browserPrimaryTitle: String {
        switch store.oauth.phase {
        case .starting: "Opening sign-in…"
        case .waiting, .exchanging: "Waiting for sign-in…"
        case .testing: "Testing connection…"
        case .authorized: "Retry connection test"
        default: "Connect OpenRouter"
        }
    }
    private var primaryDisabled: Bool {
        if store.isBusy { return true }
        if store.step != .connect { return false }
        if store.usesBrowserSignIn {
            return store.oauth.isActive && store.oauth.phase != .authorized
        }
        return !store.canSubmit
    }
    private func startBrowserSignIn() {
        store.oauth.start { NSWorkspace.shared.open($0) }
    }

    private var providerPicker: some View {
        Picker("AI service", selection: $store.providerId) {
            Text("OpenRouter · Recommended").tag("openrouter")
            Text("Vercel AI Gateway").tag("vercel")
        }
        .disabled(store.navigationLocked)
    }

    private var pricing: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Usage and any introductory credits depend on your provider’s plan.")
                .font(.callout).foregroundStyle(AppTheme.secondaryText)
            Link("Review pricing and account credits ↗", destination: URL(string: store.providerId == "vercel"
                 ? "https://vercel.com/docs/ai-gateway/pricing" : "https://openrouter.ai/settings/credits")!)
        }
    }

    @ViewBuilder private func guideLink(step id: String, fallback: String) -> some View {
        if store.isLoading {
            ProgressView("Loading setup instructions…").controlSize(.small)
        } else if let step = store.guide?.steps.first(where: { $0.id == id }),
                  let value = step.url, let url = URL(string: value) {
            Link(destination: url) {
                Label(step.urlLabel ?? fallback, systemImage: "arrow.up.right.square")
            }.buttonStyle(.bordered)
        } else {
            Button("Try loading instructions again") { Task { await store.loadGuide() } }
        }
    }

    private func overviewRow(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol).font(.title2).foregroundStyle(AppTheme.accent)
                .frame(width: 28).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.headline)
                Text(detail).foregroundStyle(AppTheme.secondaryText)
            }
        }.accessibilityElement(children: .combine)
    }

    @ViewBuilder private func credentialField(_ field: AIProviderSetupField) -> some View {
        let binding = Binding(get: { store.fields[field.key] ?? "" }, set: { store.fields[field.key] = $0 })
        Group {
            if field.secret == true {
                SecureField(field.placeholder ?? "Paste your key", text: binding)
            } else {
                TextField(field.placeholder ?? "", text: binding)
            }
        }
        .textFieldStyle(.roundedBorder)
        .focused($focusedField, equals: field.key)
        .accessibilityLabel(field.label)
        .accessibilityIdentifier("ai-provider-setup-field-\(field.key)")
        .disabled(store.navigationLocked)
    }

    private var footer: some View {
        HStack(spacing: 16) {
            if store.step != .welcome && store.step != .ready {
                Button("Back") { store.go(to: store.step == .connect ? .account : .welcome) }
                    .disabled(store.navigationLocked)
            }
            Text("\(store.step.rawValue + 1) of 4 · \(store.step.label)")
                .font(.callout).foregroundStyle(AppTheme.secondaryText)
            Spacer()
            if store.step != .ready {
                Button("Set up later") { store.oauth.cancel(); onDismiss() }
                    .keyboardShortcut(.cancelAction).disabled(store.isBusy)
            }
            Button(action: advance) {
                HStack(spacing: 8) {
                    if store.isBusy || (store.oauth.isActive && store.oauth.phase != .authorized) { ProgressView().controlSize(.small) }
                    Text(primaryTitle)
                }
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
            .disabled(primaryDisabled)
            .accessibilityIdentifier("ai-provider-setup-next")
        }
    }

    private var primaryTitle: String {
        switch store.step {
        case .welcome: "Get started"
        case .account: store.usesBrowserSignIn ? "Connect OpenRouter" : "I’m ready to connect"
        case .connect:
            store.usesBrowserSignIn ? browserPrimaryTitle : (store.isSubmitting ? "Testing connection…" : "Connect and test")
        case .ready: onStartChat == nil ? "Done" : "Start chatting"
        }
    }
    private func advance() {
        switch store.step {
        case .welcome: store.go(to: .account)
        case .account:
            store.go(to: .connect)
            if store.usesBrowserSignIn { startBrowserSignIn() }
        case .connect:
            if store.usesBrowserSignIn {
                if store.oauth.phase == .authorized { store.oauth.retryTest() }
                else { startBrowserSignIn() }
            } else {
                Task { if await store.submit() { onCompleted?() } }
            }
        case .ready:
            onDismiss()
            onStartChat?()
        }
    }
}
