import ApplicationServices
import EventKit
import SwiftUI

@main
struct TobyApp: App {
	@State private var store = ChatStore()
	@State private var configureStore = ConfigureStore()
	@State private var recordingsStore = RecordingsStore()
	@State private var schedulesStore = SchedulesStore()
	@State private var integrationsStore = ConfigureStore()
	@State private var changelogStore = ChangelogStore()
	@State private var nativeServer = NativeServer.shared

	var body: some Scene {
		WindowGroup {
			RootView(
				store: store,
				configureStore: configureStore,
				recordingsStore: recordingsStore,
				schedulesStore: schedulesStore,
				integrationsStore: integrationsStore
			)
				.frame(minWidth: 860, minHeight: 560)
				.coordinateSpace(name: "TobyWindow")
				.onAppear {
					nativeServer.start()
					requestNativePermissions()
				}
				.onDisappear {
					nativeServer.stop()
				}
		}
		.windowStyle(.hiddenTitleBar)
		.defaultSize(width: 1024, height: 720)

		Window("Settings", id: "settings") {
			ConfigureView(store: configureStore)
		}
		.windowStyle(.automatic)
		.defaultSize(width: 920, height: 640)

		Window("Recordings", id: "recordings") {
			RecordingsView(store: recordingsStore)
		}
		.windowStyle(.automatic)
		.defaultSize(width: 920, height: 640)

		Window("Schedules", id: "schedules") {
			SchedulesView(store: schedulesStore)
		}
		.windowStyle(.automatic)
		.defaultSize(width: 920, height: 640)

		Window("Integrations", id: "integrations") {
			IntegrationsView(store: integrationsStore)
		}
		.windowStyle(.automatic)
		.defaultSize(width: 920, height: 640)

		Window("Permissions", id: "permissions") {
			PermissionsView()
		}
		.windowStyle(.automatic)
		.defaultSize(width: 620, height: 520)

		Window("What’s New", id: "changelog") {
			ChangelogView(store: changelogStore)
		}
		.windowStyle(.automatic)
		.defaultSize(width: 520, height: 640)

		.commands {
			CommandGroup(replacing: .newItem) {
				Button("New Chat") {
					NotificationCenter.default.post(name: .startNewChat, object: nil)
				}
				.keyboardShortcut("n", modifiers: .command)
			}

			CommandGroup(after: .newItem) {
				OpenPermissionsMenuItem()
			}

			CommandGroup(after: .sidebar) {
				Button("Search Sessions…") {
					NotificationCenter.default.post(name: .openCommandPalette, object: nil)
				}
				.keyboardShortcut("k", modifiers: .command)
			}

			CommandGroup(after: .help) {
				Button("Show Changelog") {
					NotificationCenter.default.post(name: .openChangelog, object: nil)
				}
				.keyboardShortcut("l", modifiers: [.command, .shift])
				Button("Report an Issue…") {
					NotificationCenter.default.post(name: .openIssueReport, object: nil)
				}
				.keyboardShortcut("i", modifiers: [.command, .shift])
			}
		}
	}

	private func requestNativePermissions() {
		// Only prompt for Calendar access if not already granted
		if #available(macOS 14.0, *) {
			if EKEventStore.authorizationStatus(for: .event) != .fullAccess {
				_ = NativeCalendarHandler.requestAccess()
			}
		} else {
			if EKEventStore.authorizationStatus(for: .event) != .authorized {
				_ = NativeCalendarHandler.requestAccess()
			}
		}
		// Don't prompt for Accessibility on launch - it's not persistent for
		// ad-hoc signed binaries. The native API endpoints will prompt on-demand
		// when an Accessibility operation is actually needed.
	}
}

struct OpenPermissionsMenuItem: View {
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		Button("Permissions…") {
			openWindow(id: "permissions")
		}
	}
}
