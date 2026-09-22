import AppKit
import SwiftUI

struct EmailSetupWizardView: View {
	var onCompleted: (() -> Void)?
	var onDismiss: () -> Void

	@State private var store: EmailSetupStore
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@FocusState private var focusedField: String?

	init(
		initialEmail: String? = nil,
		store: EmailSetupStore? = nil,
		onCompleted: (() -> Void)? = nil,
		onDismiss: @escaping () -> Void
	) {
		self.onCompleted = onCompleted
		self.onDismiss = onDismiss
		_store = State(initialValue: store ?? EmailSetupStore(initialEmail: initialEmail))
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
		.onChange(of: store.step) { _, step in
			focusedField = step == .account ? "email" : (step == .credentials ? "password" : nil)
		}
		.accessibilityIdentifier("email-setup-wizard")
	}

	private var introduction: some View {
		VStack(alignment: .leading, spacing: 18) {
			Image(systemName: store.step == .ready ? "checkmark.circle" : "envelope")
				.font(.system(size: 36, weight: .light))
				.foregroundStyle(AppTheme.accent)
				.accessibilityHidden(true)
			Text("Set up Toby")
				.font(.subheadline)
				.foregroundStyle(AppTheme.secondaryText)
			Text(store.step.title)
				.font(.system(size: 26, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
				.fixedSize(horizontal: false, vertical: true)
			Text(store.step.explanation)
				.font(.body)
				.foregroundStyle(AppTheme.secondaryText)
				.fixedSize(horizontal: false, vertical: true)
		}
	}

	@ViewBuilder private var page: some View {
		@Bindable var store = store
		switch store.step {
		case .welcome:
			VStack(alignment: .leading, spacing: 24) {
				overviewRow("envelope", "Enter your address", "Toby looks up the mail servers for that domain.")
				overviewRow("server.rack", "Confirm the servers", "Host, port, and TLS are filled in when Toby finds them.")
				overviewRow("key", "Add a password", "Many providers need an app password instead of your account password.")
			}
		case .account:
			labeledField("Email address", identifier: "email-setup-address") {
				TextField("name@example.com", text: $store.email)
					.textFieldStyle(.roundedBorder)
					.focused($focusedField, equals: "email")
					.accessibilityIdentifier("email-setup-address")
			}
			Text("Toby checks known providers first, then a public mail-settings directory for other domains.")
				.foregroundStyle(AppTheme.secondaryText)
		case .servers:
			Text(store.serverSummary)
				.foregroundStyle(AppTheme.secondaryText)
			if store.appPasswordRequired {
				Text("This provider usually requires an app password. You’ll add it on the next step.")
					.foregroundStyle(AppTheme.secondaryText)
			}
			if let documentationUrl = store.documentationUrl, let url = URL(string: documentationUrl) {
				Button("Provider setup instructions") {
					NSWorkspace.shared.open(url)
				}
				.buttonStyle(.link)
			}
			serverFields
		case .credentials:
			labeledField("Password", identifier: "email-setup-password") {
				SecureField("App password or account password", text: $store.password)
					.textFieldStyle(.roundedBorder)
					.focused($focusedField, equals: "password")
					.accessibilityIdentifier("email-setup-password")
			}
			Toggle("Use a different SMTP password", isOn: $store.useSeparateSmtpPassword)
				.toggleStyle(.checkbox)
			if store.useSeparateSmtpPassword {
				labeledField("SMTP password", identifier: "email-setup-smtp-password") {
					SecureField("SMTP password", text: $store.smtpPassword)
						.textFieldStyle(.roundedBorder)
						.accessibilityIdentifier("email-setup-smtp-password")
				}
			}
			labeledField("From name", identifier: "email-setup-from-name") {
				TextField("Optional display name", text: $store.fromName)
					.textFieldStyle(.roundedBorder)
					.accessibilityIdentifier("email-setup-from-name")
			}
		case .ready:
			overviewRow("checkmark.circle", "Mailbox connected", "Toby verified IMAP with the settings you confirmed.")
		}
	}

	private var serverFields: some View {
		@Bindable var store = store
		return VStack(alignment: .leading, spacing: 14) {
			labeledField("IMAP host", identifier: "email-setup-imap-host") {
				TextField("imap.example.com", text: $store.settings.imapHost)
					.textFieldStyle(.roundedBorder)
					.accessibilityIdentifier("email-setup-imap-host")
			}
			HStack(spacing: 12) {
				labeledField("IMAP port", identifier: "email-setup-imap-port") {
					TextField("993", text: $store.settings.imapPort)
						.textFieldStyle(.roundedBorder)
						.accessibilityIdentifier("email-setup-imap-port")
				}
				Toggle("IMAP TLS", isOn: secureBinding(\.imapSecure))
					.toggleStyle(.checkbox)
			}
			labeledField("Username", identifier: "email-setup-username") {
				TextField("name@example.com", text: $store.settings.imapUsername)
					.textFieldStyle(.roundedBorder)
					.accessibilityIdentifier("email-setup-username")
			}
			labeledField("SMTP host", identifier: "email-setup-smtp-host") {
				TextField("smtp.example.com", text: $store.settings.smtpHost)
					.textFieldStyle(.roundedBorder)
					.accessibilityIdentifier("email-setup-smtp-host")
			}
			HStack(spacing: 12) {
				labeledField("SMTP port", identifier: "email-setup-smtp-port") {
					TextField("587", text: $store.settings.smtpPort)
						.textFieldStyle(.roundedBorder)
						.accessibilityIdentifier("email-setup-smtp-port")
				}
				Toggle("SMTP TLS", isOn: secureBinding(\.smtpSecure))
					.toggleStyle(.checkbox)
			}
		}
	}

	private func labeledField<Content: View>(
		_ title: String,
		identifier: String,
		@ViewBuilder content: () -> Content
	) -> some View {
		VStack(alignment: .leading, spacing: 6) {
			Text(title)
				.font(.callout.weight(.medium))
				.foregroundStyle(AppTheme.primaryText)
			content()
		}
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier(identifier)
	}

	private func secureBinding(_ keyPath: WritableKeyPath<EmailDiscoverSettings, String>) -> Binding<Bool> {
		Binding(
			get: { store.settings[keyPath: keyPath] == "true" },
			set: { store.settings[keyPath: keyPath] = $0 ? "true" : "false" }
		)
	}

	private func overviewRow(_ symbol: String, _ title: String, _ detail: String) -> some View {
		HStack(alignment: .top, spacing: 14) {
			Image(systemName: symbol)
				.font(.title2)
				.foregroundStyle(AppTheme.accent)
				.frame(width: 28)
				.accessibilityHidden(true)
			VStack(alignment: .leading, spacing: 5) {
				Text(title).font(.headline)
				Text(detail).foregroundStyle(AppTheme.secondaryText)
			}
		}
		.accessibilityElement(children: .combine)
	}

	private var footer: some View {
		HStack(spacing: 16) {
			if store.step != .welcome && store.step != .ready {
				Button("Back", action: goBack)
					.disabled(store.navigationLocked)
			}
			Text("\(store.step.rawValue + 1) of \(EmailSetupStore.Step.allCases.count) · \(store.step.label)")
				.font(.callout)
				.foregroundStyle(AppTheme.secondaryText)
			Spacer()
			if store.step != .ready {
				Button("Set up later") { onDismiss() }
					.keyboardShortcut(.cancelAction)
					.disabled(store.isBusy)
			}
			Button(action: advance) {
				HStack(spacing: 8) {
					if store.isBusy {
						ProgressView().controlSize(.small)
					}
					Text(primaryTitle)
				}
			}
			.buttonStyle(.borderedProminent)
			.keyboardShortcut(.defaultAction)
			.disabled(primaryDisabled)
			.accessibilityIdentifier("email-setup-next")
		}
	}

	private var primaryTitle: String {
		switch store.step {
		case .welcome: "Get started"
		case .account: store.isDiscovering ? "Looking up settings…" : "Discover settings"
		case .servers: "Continue"
		case .credentials: store.isSubmitting ? "Connecting…" : "Connect"
		case .ready: "Done"
		}
	}

	private var primaryDisabled: Bool {
		if store.navigationLocked { return true }
		switch store.step {
		case .welcome, .ready: return false
		case .account: return !store.canDiscover
		case .servers: return !store.canContinueFromServers
		case .credentials: return !store.canConnect
		}
	}

	private func goBack() {
		switch store.step {
		case .account: store.go(to: .welcome)
		case .servers: store.go(to: .account)
		case .credentials: store.go(to: .servers)
		case .welcome, .ready: break
		}
	}

	private func advance() {
		switch store.step {
		case .welcome:
			store.go(to: .account)
		case .account:
			Task { await store.discover() }
		case .servers:
			if store.settings.imapUsername.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				store.settings.imapUsername = store.email
			}
			if store.settings.smtpUsername.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				store.settings.smtpUsername = store.settings.imapUsername
			}
			if store.settings.fromAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				store.settings.fromAddress = store.email
			}
			store.go(to: .credentials)
		case .credentials:
			Task {
				if await store.connect() {
					onCompleted?()
				}
			}
		case .ready:
			onDismiss()
		}
	}
}
