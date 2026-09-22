import AppKit
import SwiftUI

struct NewsSetupWizardView: View {
	var onCompleted: (() -> Void)?
	var onDismiss: () -> Void

	@State private var store: NewsSetupStore
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@FocusState private var focusedField: String?

	init(
		initialSource: String? = nil,
		initialSection: String? = nil,
		store: NewsSetupStore? = nil,
		onCompleted: (() -> Void)? = nil,
		onDismiss: @escaping () -> Void
	) {
		self.onCompleted = onCompleted
		self.onDismiss = onDismiss
		_store = State(
			initialValue: store
				?? NewsSetupStore(initialSource: initialSource, initialSection: initialSection)
		)
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
			focusedField = step == .guardian ? "apiKey" : nil
		}
		.accessibilityIdentifier("news-setup-wizard")
	}

	private var introduction: some View {
		VStack(alignment: .leading, spacing: 18) {
			Image(systemName: store.step == .ready ? "checkmark.circle" : "newspaper")
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
				overviewRow("newspaper", "Hacker News", "No key. Front page, newest, Ask HN, and Show HN.")
				overviewRow("globe", "The Guardian", "Optional free key for world, science, and culture coverage.")
				overviewRow("slider.horizontal.3", "Choose defaults", "Pick a source and, if you use The Guardian, a section.")
			}
		case .sources:
			Picker("Default source", selection: $store.source) {
				ForEach(NewsSetupStore.Source.allCases) { source in
					Text(source.label).tag(source)
				}
			}
			.pickerStyle(.radioGroup)
			.accessibilityIdentifier("news-setup-source")
			if store.includesGuardian {
				Picker("Default Guardian section", selection: $store.defaultSection) {
					ForEach(NewsSetupStore.sections) { section in
						Text(section.label).tag(section.id)
					}
				}
				.accessibilityIdentifier("news-setup-section")
				Text("The section applies only to Guardian requests that do not name one.")
					.foregroundStyle(AppTheme.secondaryText)
			} else {
				Text("You can add a Guardian key on the next step, or leave it blank.")
					.foregroundStyle(AppTheme.secondaryText)
			}
		case .guardian:
			if let url = URL(string: NewsSetupStore.guardianKeyURL) {
				Button("Get a free Guardian API key") {
					NSWorkspace.shared.open(url)
				}
				.buttonStyle(.link)
			}
			labeledField("Guardian API key", identifier: "news-setup-api-key") {
				HStack {
					SecureField("Optional unless you chose The Guardian only", text: $store.apiKey)
						.textFieldStyle(.roundedBorder)
						.focused($focusedField, equals: "apiKey")
						.accessibilityIdentifier("news-setup-api-key")
					Button("Paste") {
						if let value = NSPasteboard.general.string(forType: .string) {
							store.apiKey = value.trimmingCharacters(in: .whitespacesAndNewlines)
						}
					}
					.accessibilityLabel("Paste Guardian API key")
				}
			}
			Text(
				store.requiresGuardianKey
					? "The Guardian requires this key. Toby checks it when you connect."
					: "Leave this blank to use Hacker News only. Toby checks Hacker News when you connect."
			)
			.foregroundStyle(AppTheme.secondaryText)
		case .ready:
			overviewRow("checkmark.circle", "News connected", "Toby verified the sources you chose.")
			overviewRow("bubble.left.and.bubble.right", "Ask in chat", "Try “What’s on Hacker News right now?”")
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
			Text("\(store.step.rawValue + 1) of \(NewsSetupStore.Step.allCases.count) · \(store.step.label)")
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
			.accessibilityIdentifier("news-setup-next")
		}
	}

	private var primaryTitle: String {
		switch store.step {
		case .welcome: "Get started"
		case .sources: "Continue"
		case .guardian: store.isSubmitting ? "Connecting…" : "Connect"
		case .ready: "Done"
		}
	}

	private var primaryDisabled: Bool {
		if store.navigationLocked { return true }
		switch store.step {
		case .welcome, .sources, .ready: return false
		case .guardian: return !store.canConnect
		}
	}

	private func goBack() {
		switch store.step {
		case .sources: store.go(to: .welcome)
		case .guardian: store.go(to: .sources)
		case .welcome, .ready: break
		}
	}

	private func advance() {
		switch store.step {
		case .welcome:
			store.go(to: .sources)
		case .sources:
			store.go(to: .guardian)
		case .guardian:
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
