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
	@State private var flowsStore = FlowsStore()
	@State private var changelogStore = ChangelogStore()
	@State private var pluginsStore = PluginsStore()
	@State private var updateStore = UpdateStore()
	@State private var personaEditorCoordinator = PersonaEditorCoordinator()
	@State private var logsStore = LogsStore()
	@State private var nativeServer = NativeServer.shared
	@State private var menuBarController: MenuBarController?
	@State private var appearancePreferences = AppearancePreferences.shared

	init() {
		// Hide system View menu items that are not useful for Toby:
		// "Show Tab Bar" / "Show All Tabs" and "Enter Full Screen".
		NSWindow.allowsAutomaticWindowTabbing = false
		UserDefaults.standard.set(false, forKey: "NSFullScreenMenuItemEverywhere")
		// Apply saved appearance before first window draws.
		AppearancePreferences.shared.applyToApp()
	}

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
				flowsStore: flowsStore,
				personaEditorCoordinator: personaEditorCoordinator,
				updateStore: updateStore,
				changelogStore: changelogStore,
				pluginsStore: pluginsStore
			)
				.frame(minWidth: 860, minHeight: 560)
				.coordinateSpace(name: "TobyWindow")
				.tobyAppearance(appearancePreferences)
				.onAppear {
					nativeServer.start()
					requestNativePermissions()
					if menuBarController == nil {
						menuBarController = MenuBarController(
							showStatusItem: appearancePreferences.showMenuBarIcon
						)
					} else {
						menuBarController?.setStatusItemVisible(
							appearancePreferences.showMenuBarIcon
						)
					}
					// Re-apply login item if the user enabled it previously.
					if appearancePreferences.launchAtLogin {
						appearancePreferences.applyLaunchAtLogin()
					}
					// Register the system-wide command palette hotkey (if set).
					GlobalHotkeyController.shared.start(prefs: appearancePreferences)
					activateDebugPreviewWindow()
				}
				.onChange(of: appearancePreferences.showMenuBarIcon) { _, show in
					menuBarController?.setStatusItemVisible(show)
				}
				.onDisappear {
					nativeServer.stop()
					GlobalHotkeyController.shared.stop()
				}
		}
		.windowStyle(.hiddenTitleBar)
		.defaultSize(width: 1024, height: 720)

		// Secondary windows: .commandsRemoved() keeps them out of the Window menu
		// (open via Help / in-app actions instead).
		Window("Permissions", id: "permissions") {
			PermissionsView()
				.tobyAppearance(appearancePreferences)
				.onDisappear { NotificationCenter.default.post(name: .secondaryWindowClosed, object: nil) }
		}
		.windowStyle(.automatic)
		.defaultSize(width: 620, height: 520)
		.commandsRemoved()

		Window("Persona Editor", id: "persona-editor") {
			Group {
				if let editorStore = personaEditorCoordinator.store {
					PersonaEditorView(
						store: editorStore,
						onSaved: {
							Task { await store.refreshStatus() }
							NotificationCenter.default.post(name: .personasDidChange, object: nil)
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
			.tobyAppearance(appearancePreferences)
			.onDisappear { NotificationCenter.default.post(name: .secondaryWindowClosed, object: nil) }
		}
		.windowStyle(.automatic)
		.defaultSize(width: 560, height: 580)
		.commandsRemoved()

		Window("Logs", id: "logs") {
			LogsView(store: logsStore)
				.tobyAppearance(appearancePreferences)
				.onDisappear {
					logsStore.stopPolling()
					NotificationCenter.default.post(name: .secondaryWindowClosed, object: nil)
				}
		}
		.windowStyle(.automatic)
		.defaultSize(width: 980, height: 680)
		.commandsRemoved()

		Window("Settings", id: "settings") {
			SettingsWindowView(store: configureStore)
				.tobyAppearance(appearancePreferences)
				.onDisappear {
					NotificationCenter.default.post(name: .secondaryWindowClosed, object: nil)
				}
		}
		.windowStyle(.automatic)
		.defaultSize(width: 750, height: 535)
		.commandsRemoved()

		.commands {
			CommandGroup(replacing: .newItem) {
				Button("New Chat") {
					NotificationCenter.default.post(name: .startNewChat, object: nil)
				}
				.keyboardShortcut("n", modifiers: .command)

				Button("New Schedule") {
					NotificationCenter.default.post(name: .startNewSchedule, object: nil)
				}

				Button("New Project") {
					NotificationCenter.default.post(name: .startNewProject, object: nil)
				}

				Button("New Memory") {
					NotificationCenter.default.post(name: .startNewMemory, object: nil)
				}
			}

			CommandGroup(after: .newItem) {
				Divider()

				Button("Backup Settings…") {
					NotificationCenter.default.post(name: .backupConfig, object: nil)
				}

				Button("Restore Settings…") {
					NotificationCenter.default.post(name: .restoreConfig, object: nil)
				}
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
				OpenSettingsMenuItem()
			}

			CommandGroup(after: .sidebar) {
				Button("Command Palette") {
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
				OpenPermissionsMenuItem()
			}
		}
	}

	/// Returns a keyboard shortcut for each view route (Cmd+1 through Cmd+9).
	/// Settings uses Cmd+, from the app settings command group.
	private func viewShortcut(for route: DetailRoute) -> KeyboardShortcut? {
		switch route {
		case .dashboard: return KeyboardShortcut("1", modifiers: .command)
		case .chat: return KeyboardShortcut("2", modifiers: .command)
		case .integrations: return KeyboardShortcut("3", modifiers: .command)
		case .projects: return KeyboardShortcut("4", modifiers: .command)
		case .skills: return KeyboardShortcut("5", modifiers: .command)
		case .memories: return KeyboardShortcut("6", modifiers: .command)
		case .schedules: return KeyboardShortcut("7", modifiers: .command)
		case .flows: return KeyboardShortcut("8", modifiers: .command)
		case .recordings: return KeyboardShortcut("9", modifiers: .command)
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

struct OpenSettingsMenuItem: View {
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		Button("Settings…") {
			openWindow(id: "settings")
		}
		.keyboardShortcut(",", modifiers: .command)
	}
}
