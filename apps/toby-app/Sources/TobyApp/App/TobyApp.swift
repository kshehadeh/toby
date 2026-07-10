import AppKit
import ApplicationServices
import EventKit
import SwiftUI

@main
struct TobyApp: App {
	@State private var store = ChatStore()
	@State private var dashboardStore = DashboardStore()
	@State private var configureStore = ConfigureStore()
	@State private var recordingsStore = RecordingsStore()
	@State private var schedulesStore = SchedulesStore()
	@State private var projectsStore = ProjectsStore()
	@State private var integrationsStore = ConfigureStore()
	@State private var skillsStore = SkillsStore()
	@State private var memoriesStore = MemoriesStore()
	@State private var changelogStore = ChangelogStore()
	@State private var pluginsStore = PluginsStore()
	@State private var updateStore = UpdateStore()
	@State private var personaEditorCoordinator = PersonaEditorCoordinator()
	@State private var logsStore = LogsStore()
	@State private var nativeServer = NativeServer.shared
	@State private var menuBarController: MenuBarController?

	var body: some Scene {
		WindowGroup {
			RootView(
				store: store,
				dashboardStore: dashboardStore,
				configureStore: configureStore,
				recordingsStore: recordingsStore,
				schedulesStore: schedulesStore,
				projectsStore: projectsStore,
				integrationsStore: integrationsStore,
				skillsStore: skillsStore,
				memoriesStore: memoriesStore,
				personaEditorCoordinator: personaEditorCoordinator,
				updateStore: updateStore,
				changelogStore: changelogStore,
				pluginsStore: pluginsStore
			)
				.frame(minWidth: 860, minHeight: 560)
				.coordinateSpace(name: "TobyWindow")
				.onAppear {
					nativeServer.start()
					requestNativePermissions()
					if menuBarController == nil {
						menuBarController = MenuBarController()
					}
					activateDebugPreviewWindow()
				}
				.onDisappear {
					nativeServer.stop()
				}
		}
		.windowStyle(.hiddenTitleBar)
		.defaultSize(width: 1024, height: 720)

		Window("Permissions", id: "permissions") {
			PermissionsView()
				.onDisappear { NotificationCenter.default.post(name: .secondaryWindowClosed, object: nil) }
		}
		.windowStyle(.automatic)
		.defaultSize(width: 620, height: 520)

		Window("Persona Editor", id: "persona-editor") {
			Group {
				if let editorStore = personaEditorCoordinator.store {
					PersonaEditorView(
						store: editorStore,
						onSaved: {
							Task { await store.refreshStatus() }
						},
						onCancel: {
							personaEditorCoordinator.store = nil
						}
					)
				} else {
					Text("No persona selected")
						.frame(maxWidth: .infinity, maxHeight: .infinity)
						.background(SettingsDesign.canvasBackground)
				}
			}
			.onDisappear { NotificationCenter.default.post(name: .secondaryWindowClosed, object: nil) }
		}
		.windowStyle(.automatic)
		.defaultSize(width: 560, height: 580)

		Window("Logs", id: "logs") {
			LogsView(store: logsStore, tobyDirectory: store.status?.tobyDir)
				.onDisappear {
					logsStore.stopPolling()
					NotificationCenter.default.post(name: .secondaryWindowClosed, object: nil)
				}
		}
		.windowStyle(.automatic)
		.defaultSize(width: 980, height: 680)

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

			CommandGroup(replacing: .appInfo) {
				Button("About Toby") {
					NotificationCenter.default.post(name: .openChangelog, object: nil)
				}

				Button("Check for Updates…") {
					Task { await updateStore.checkNativeAppForUpdates() }
				}
				.disabled(updateStore.isUpgrading)
			}

			CommandGroup(replacing: .appSettings) {
				Button("Settings…") {
					NotificationCenter.default.post(name: .navigateToRoute, object: DetailRoute.settings.rawValue)
				}
				.keyboardShortcut(",", modifiers: .command)
			}

			CommandGroup(after: .sidebar) {
				Button("Search Sessions…") {
					NotificationCenter.default.post(name: .openCommandPalette, object: nil)
				}
				.keyboardShortcut("k", modifiers: .command)

				Divider()

				ForEach(DetailRoute.allCases) { route in
					Button {
						NotificationCenter.default.post(name: .navigateToRoute, object: route.rawValue)
					} label: {
						Label(route.menuTitle, systemImage: route.systemImage)
					}
					.keyboardShortcut(viewShortcut(for: route))
				}
			}

			CommandGroup(replacing: .help) {
				Button("Toby Help") {
					if let url = URL(string: "https://toby.iwonderdesigns.com/docs/intro") {
						NSWorkspace.shared.open(url)
					}
				}
				.keyboardShortcut("?", modifiers: .command)

				Divider()

				Button("Show Changelog") {
					NotificationCenter.default.post(name: .openChangelog, object: nil)
				}
				.keyboardShortcut("l", modifiers: [.command, .shift])
				Button("Report an Issue…") {
					NotificationCenter.default.post(name: .openIssueReport, object: nil)
				}
				.keyboardShortcut("i", modifiers: [.command, .shift])
				OpenLogsMenuItem()
			}
		}
	}

	/// Returns a keyboard shortcut for each view route (Cmd+1 through Cmd+8).
	/// Settings uses Cmd+, from the app settings command group, so it gets no
	/// duplicate shortcut here.
	private func viewShortcut(for route: DetailRoute) -> KeyboardShortcut? {
		switch route {
		case .dashboard: return KeyboardShortcut("1", modifiers: .command)
		case .chat: return KeyboardShortcut("2", modifiers: .command)
		case .integrations: return KeyboardShortcut("3", modifiers: .command)
		case .projects: return KeyboardShortcut("4", modifiers: .command)
		case .skills: return KeyboardShortcut("5", modifiers: .command)
		case .memories: return KeyboardShortcut("6", modifiers: .command)
		case .schedules: return KeyboardShortcut("7", modifiers: .command)
		case .recordings: return KeyboardShortcut("8", modifiers: .command)
		case .settings: return nil
		}
	}

	private func requestNativePermissions() {
		// Only prompt for Calendar access if not already granted
		if #available(macOS 14.0, *) {
			if EKEventStore.authorizationStatus(for: .event) != .fullAccess {
				Task { _ = await NativeCalendarHandler.requestAccess() }
			}
		} else {
			if EKEventStore.authorizationStatus(for: .event) != .authorized {
				Task { _ = await NativeCalendarHandler.requestAccess() }
			}
		}
		// Don't prompt for Accessibility on launch - it's not persistent for
		// ad-hoc signed binaries. The native API endpoints will prompt on-demand
		// when an Accessibility operation is actually needed.
	}

#if DEBUG
	private func activateDebugPreviewWindow() {
		let latestVersion = ProcessInfo.processInfo.environment["TOBY_DEBUG_LATEST_VERSION"]?
			.trimmingCharacters(in: .whitespacesAndNewlines)
		guard latestVersion?.isEmpty == false else { return }

		NSApp.setActivationPolicy(.regular)
		DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
			NSApp.activate(ignoringOtherApps: true)
			NSApp.windows.first?.makeKeyAndOrderFront(nil)
		}
	}
#else
	private func activateDebugPreviewWindow() {}
#endif
}

struct OpenPermissionsMenuItem: View {
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		Button("Permissions…") {
			openWindow(id: "permissions")
		}
	}
}

struct OpenLogsMenuItem: View {
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		Button("Logs…") {
			openWindow(id: "logs")
		}
	}
}
