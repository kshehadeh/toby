import AppKit
import SwiftUI

/// Settings sections for the all-Swift app. Each section is a native pane;
/// nothing is driven by a server-side configure tree.
enum NativeSettingsSection: String, CaseIterable, Identifiable {
	case general, account, sources, personas, followups, recordings, chatReplies, sync, permissions

	var id: String { rawValue }

	var title: String {
		switch self {
		case .general: "General"
		case .account: "Account"
		case .sources: "Sources"
		case .personas: "Personas"
		case .followups: "Follow-ups"
		case .recordings: "Recordings"
		case .chatReplies: "Chat Replies"
		case .sync: "Sync & Backup"
		case .permissions: "Permissions"
		}
	}

	var systemImage: String {
		switch self {
		case .general: "gearshape"
		case .account: "person.crop.circle"
		case .sources: "tray.2"
		case .personas: "theatermasks"
		case .followups: "arrow.uturn.forward.circle"
		case .recordings: "waveform"
		case .chatReplies: "bubble.left.and.bubble.right"
		case .sync: "icloud"
		case .permissions: "lock.shield"
		}
	}

	/// Map older deep-link keys (configure tree, integrations) to a section.
	init(navKey: String) {
		let key = navKey.lowercased()
		if let exact = NativeSettingsSection(rawValue: navKey) {
			self = exact
		} else if key == SettingsItem.appearanceSectionKey {
			self = .general
		} else if key == SettingsItem.iCloudSectionKey || key.hasPrefix("sync") || key.contains("backup") {
			self = .sync
		} else if key.hasPrefix(SettingsItem.personasSectionKey) {
			self = .personas
		} else if key == SettingsItem.followupsSectionKey {
			self = .followups
		} else if key == "transcription" || key.hasPrefix("listen") || key.hasPrefix("recording") {
			self = .recordings
		} else if key.hasPrefix("chatinbound") {
			self = .chatReplies
		} else if key == "email" || key == "mail" || key == "slack" || key.hasPrefix("integrations")
			|| key.hasPrefix("apple") || key == "macos" || key == "dashboard" {
			self = .sources
		} else if key == "permissions" {
			self = .permissions
		} else if key == "ai" || key.hasPrefix("ai.") || key == "defaults" || key.contains("openrouter") {
			self = .account
		} else {
			self = .general
		}
	}
}

struct NativeSettingsView: View {
	@Bindable var store: ConfigureStore
	var onSwitchTobyHome: ((String?) async throws -> Void)? = nil

	@AppStorage("toby.settings.nativeLastSection") private var lastSection = NativeSettingsSection.general.rawValue
	@State private var selection: NativeSettingsSection? = .general
	@State private var appearancePreferences = AppearancePreferences.shared
	@State private var followupsStore = FollowupsSettingsStore()
	@State private var personasPath: [String] = []

	var body: some View {
		NavigationSplitView(columnVisibility: .constant(.all)) {
			List(NativeSettingsSection.allCases, selection: $selection) { section in
				Label(section.title, systemImage: section.systemImage)
					.tag(section)
					.accessibilityIdentifier("settings-sidebar-\(section.rawValue)")
			}
			.listStyle(.sidebar)
			.scrollEdgeEffectStyleSoftIfAvailable()
			.navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 240)
			.toolbar(removing: .sidebarToggle)
			.accessibilityIdentifier("settings-sidebar")
		} detail: {
			detail
				.navigationTitle((selection ?? .general).title)
				.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
				.tobyThemeRefreshable()
		}
		.navigationTitle("Settings")
		.navigationSplitViewStyle(.balanced)
		.frame(minWidth: 700, minHeight: 480)
		.background {
			WindowAccessor { window in
				window.styleMask.insert(.fullSizeContentView)
				window.toolbarStyle = .unified
				window.isMovableByWindowBackground = true
			}
		}
		.onAppear {
			if !consumeDeepLink() { selection = NativeSettingsSection(rawValue: lastSection) ?? .general }
		}
		.onChange(of: store.selectedNavKey) { _, _ in _ = consumeDeepLink() }
		.onChange(of: store.pendingPersonaSelection) { _, name in
			if name != nil { selection = .personas }
		}
		.onChange(of: selection) { _, next in
			if let next { lastSection = next.rawValue }
		}
	}

	/// Apply `RootSettingsNavigation` selection, if any.
	private func consumeDeepLink() -> Bool {
		if store.pendingPersonaSelection != nil {
			selection = .personas
			return true
		}
		guard let key = store.selectedNavKey else { return false }
		store.selectedNavKey = nil
		selection = NativeSettingsSection(navKey: key)
		return true
	}

	@ViewBuilder
	private var detail: some View {
		switch selection ?? .general {
		case .general:
			AppearanceSettingsView(preferences: appearancePreferences, onSwitchTobyHome: onSwitchTobyHome)
		case .account:
			AccountSettingsPane()
		case .sources:
			SourcesSettingsPane()
		case .personas:
			PersonasSettingsView(store: store, path: $personasPath)
		case .followups:
			FollowupsSettingsView(store: followupsStore)
		case .recordings:
			RecordingsSettingsPane()
		case .chatReplies:
			ChatRepliesSettingsPane()
		case .sync:
			ICloudSyncSettingsView()
		case .permissions:
			PermissionsView()
		}
	}
}
