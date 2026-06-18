import ApplicationServices
import EventKit
import SwiftUI

@main
struct TobyApp: App {
	@State private var store = ChatStore()
	@State private var configureStore = ConfigureStore()
	@State private var recordingsStore = RecordingsStore()
	@State private var nativeServer = NativeServer.shared

	var body: some Scene {
		WindowGroup {
			RootView(store: store, configureStore: configureStore)
				.frame(minWidth: 860, minHeight: 560)
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

		.commands {
			CommandGroup(replacing: .newItem) {
				Button("New Chat") {
					NotificationCenter.default.post(name: .startNewChat, object: nil)
				}
				.keyboardShortcut("n", modifiers: .command)
			}

			CommandGroup(after: .sidebar) {
				Button("Search Sessions…") {
					NotificationCenter.default.post(name: .openCommandPalette, object: nil)
				}
				.keyboardShortcut("k", modifiers: .command)
			}

			CommandGroup(after: .help) {
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
