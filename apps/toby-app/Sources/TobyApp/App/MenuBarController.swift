import AppKit
import SwiftUI

/// Manages the system-wide menubar status item for Toby.
/// Provides quick access to new chat, recording toggle, and window opening.
@MainActor
final class MenuBarController: NSObject {
	private var statusItem: NSStatusItem?
	private(set) var menu: NSMenu?
	private var recordingChrome: RecordingChromeState = .idle
	private var baseMenuImage: NSImage?
	private var testMenuBarImageIsMarked = false
	/// When false, skip creating a real status item and updating dock chrome (tests).
	private let managesAppChrome: Bool

	static let recordingStateChanged = Notification.Name("menuBarRecordingStateChanged")

	init(registerStatusItem: Bool = true, showStatusItem: Bool = true) {
		self.managesAppChrome = registerStatusItem
		super.init()
		if registerStatusItem, showStatusItem {
			setupStatusItem()
		} else {
			menu = buildMenu()
		}
		observeRecordingState()
		observeMenuBarVisibilityPreference()
	}

	private func observeMenuBarVisibilityPreference() {
		guard managesAppChrome else { return }
		NotificationCenter.default.addObserver(
			self,
			selector: #selector(handleShowMenuBarIconChanged(_:)),
			name: AppearancePreferences.showMenuBarIconDidChange,
			object: nil
		)
	}

	@objc private func handleShowMenuBarIconChanged(_ notification: Notification) {
		let visible: Bool
		if let flag = notification.object as? Bool {
			visible = flag
		} else {
			visible = AppearancePreferences.shared.showMenuBarIcon
		}
		setStatusItemVisible(visible)
	}

	/// Shows or hides the menu bar status item. Dock recording indicator still
	/// updates while the status item is hidden.
	func setStatusItemVisible(_ visible: Bool) {
		guard managesAppChrome else { return }
		if visible {
			if statusItem == nil {
				setupStatusItem()
				updateMenuBarIcon()
			}
		} else {
			removeStatusItem()
		}
	}

	/// Whether a menu bar status item is currently installed.
	var isStatusItemVisible: Bool {
		statusItem != nil
	}

	private func setupStatusItem() {
		let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
		if let logoURL = Bundle.tobyResources.url(forResource: "toby-menubar", withExtension: "png"),
			let logo = NSImage(contentsOf: logoURL)
		{
			logo.size = NSSize(width: 18, height: 18)
			logo.isTemplate = true
			baseMenuImage = logo
			item.button?.image = logo
		} else if let logoURL = Bundle.tobyResources.url(forResource: "toby-128", withExtension: "png"),
			let logo = NSImage(contentsOf: logoURL)
		{
			logo.size = NSSize(width: 22, height: 22)
			logo.isTemplate = false
			baseMenuImage = logo
			item.button?.image = logo
		} else {
			let fallback = NSImage(
				systemSymbolName: "brain.head.profile",
				accessibilityDescription: "Toby"
			)
			fallback?.isTemplate = true
			baseMenuImage = fallback
			item.button?.image = fallback
		}
		let menu = buildMenu()
		item.menu = menu
		self.menu = menu
		statusItem = item
	}

	private func removeStatusItem() {
		guard let statusItem else { return }
		NSStatusBar.system.removeStatusItem(statusItem)
		self.statusItem = nil
	}

	private func buildMenu() -> NSMenu {
		let menu = NSMenu()
		menu.items = [
			newChatItem(),
			commandPaletteItem(),
			recordingItem(),
			.separator(),
			dashboardItem(),
			chatsItem(),
			integrationsItem(),
			projectsItem(),
			libraryItem(),
			skillsItem(),
			memoriesItem(),
			schedulesItem(),
			flowsItem(),
			recordingsItem(),
			settingsItem(),
			.separator(),
			quitItem(),
		]
		return menu
	}

	// MARK: - Menu items

	private func newChatItem() -> NSMenuItem {
		let item = NSMenuItem(
			title: "New Chat",
			action: #selector(postNewChat),
			keyEquivalent: "n"
		)
		item.target = self
		item.keyEquivalentModifierMask = .command
		item.image = NSImage(
			systemSymbolName: "plus.bubble",
			accessibilityDescription: nil
		)
		return item
	}

	private func commandPaletteItem() -> NSMenuItem {
		let item = NSMenuItem(
			title: "Command Palette",
			action: #selector(postOpenCommandPalette),
			keyEquivalent: "k"
		)
		item.target = self
		item.keyEquivalentModifierMask = .command
		item.image = NSImage(
			systemSymbolName: "magnifyingglass",
			accessibilityDescription: nil
		)
		return item
	}

	private func recordingItem() -> NSMenuItem {
		let item = NSMenuItem(
			title: recordingItemTitle,
			action: #selector(toggleRecording),
			keyEquivalent: ""
		)
		item.target = self
		item.tag = Self.recordingItemTag
		item.image = NSImage(
			systemSymbolName: "record.circle",
			accessibilityDescription: nil
		)
		return item
	}

	private func dashboardItem() -> NSMenuItem {
		viewMenuItem(title: DetailRoute.dashboard.menuTitle, route: .dashboard, keyEquivalent: "1")
	}

	private func chatsItem() -> NSMenuItem {
		viewMenuItem(title: DetailRoute.chat.menuTitle, route: .chat, keyEquivalent: "2")
	}

	private func recordingsItem() -> NSMenuItem {
		viewMenuItem(title: DetailRoute.recordings.menuTitle, route: .recordings, keyEquivalent: "9")
	}

	private func schedulesItem() -> NSMenuItem {
		viewMenuItem(title: DetailRoute.schedules.menuTitle, route: .schedules, keyEquivalent: "7")
	}

	private func flowsItem() -> NSMenuItem {
		viewMenuItem(title: DetailRoute.flows.menuTitle, route: .flows, keyEquivalent: "8")
	}

	private func integrationsItem() -> NSMenuItem {
		let item = NSMenuItem(
			title: "Integrations",
			action: #selector(openIntegrationsSettings),
			keyEquivalent: "3"
		)
		item.target = self
		item.keyEquivalentModifierMask = .command
		item.image = NSImage(
			systemSymbolName: "puzzlepiece.extension",
			accessibilityDescription: nil
		)
		return item
	}

	private func projectsItem() -> NSMenuItem {
		viewMenuItem(title: DetailRoute.projects.menuTitle, route: .projects, keyEquivalent: "4")
	}

	private func libraryItem() -> NSMenuItem {
		viewMenuItem(title: DetailRoute.library.menuTitle, route: .library, keyEquivalent: "0")
	}

	private func skillsItem() -> NSMenuItem {
		viewMenuItem(title: DetailRoute.skills.menuTitle, route: .skills, keyEquivalent: "5")
	}

	private func memoriesItem() -> NSMenuItem {
		let item = NSMenuItem(
			title: "Memories",
			action: #selector(openMemoriesWindow),
			keyEquivalent: "6"
		)
		item.target = self
		item.keyEquivalentModifierMask = .command
		item.image = NSImage(
			systemSymbolName: "brain.head.profile",
			accessibilityDescription: nil
		)
		return item
	}

	private func settingsItem() -> NSMenuItem {
		let item = NSMenuItem(
			title: "Settings…",
			action: #selector(openSettingsWindow),
			keyEquivalent: ","
		)
		item.target = self
		item.keyEquivalentModifierMask = .command
		item.image = NSImage(
			systemSymbolName: "gearshape",
			accessibilityDescription: nil
		)
		return item
	}

	/// Builds a menu item for a view route with the matching SF Symbol icon.
	private func viewMenuItem(title: String, route: DetailRoute, keyEquivalent: String = "") -> NSMenuItem {
		let item = NSMenuItem(
			title: title,
			action: #selector(navigateToRoute(_:)),
			keyEquivalent: keyEquivalent
		)
		item.target = self
		item.image = NSImage(
			systemSymbolName: route.systemImage,
			accessibilityDescription: nil
		)
		item.representedObject = route.rawValue as Any
		if !keyEquivalent.isEmpty {
			item.keyEquivalentModifierMask = .command
		}
		return item
	}

	private func quitItem() -> NSMenuItem {
		let item = NSMenuItem(
			title: "Quit Toby",
			action: #selector(quitApp),
			keyEquivalent: "q"
		)
		item.target = self
		item.keyEquivalentModifierMask = .command
		item.image = NSImage(
			systemSymbolName: "power",
			accessibilityDescription: nil
		)
		return item
	}

	// MARK: - Actions

	@objc private func postNewChat() {
		NotificationCenter.default.post(name: .startNewChat, object: nil)
	}

	@objc private func postOpenCommandPalette() {
		NotificationCenter.default.post(name: .openCommandPalette, object: nil)
	}

	@objc private func toggleRecording() {
		NotificationCenter.default.post(name: .menuBarToggleRecording, object: nil)
	}

	@objc private func navigateToRoute(_ sender: NSMenuItem) {
		if let raw = sender.representedObject as? String {
			NotificationCenter.default.post(name: .navigateToRoute, object: raw)
		}
	}

	@objc private func openSettingsWindow() {
		if let openWindow = OpenWindowBridge.shared.openWindow {
			openWindow("settings")
		} else {
			NotificationCenter.default.post(name: .openSettingsWindow, object: nil)
		}
	}

	@objc private func openIntegrationsSettings() {
		NotificationCenter.default.post(
			name: .openSettingsWindow,
			object: SettingsItem.integrationsSectionKey
		)
	}

	@objc private func openMemoriesWindow() {
		if let openWindow = OpenWindowBridge.shared.openWindow {
			openWindow("memories")
		} else {
			NotificationCenter.default.post(name: .openMemoriesWindow, object: nil)
		}
	}

	@objc private func quitApp() {
		NSApp.terminate(nil)
	}

	// MARK: - Recording state

	private var recordingItemTitle: String {
		switch recordingChrome {
		case .idle: "Start Recording"
		case .recording: "Stop Recording"
		case .processing: "Processing Recording"
		}
	}

	private func observeRecordingState() {
		NotificationCenter.default.addObserver(
			self,
			selector: #selector(handleRecordingStateChanged(_:)),
			name: Self.recordingStateChanged,
			object: nil
		)
	}

	@objc private func handleRecordingStateChanged(_ notification: Notification) {
		if let state = notification.object as? RecordingChromeState {
			recordingChrome = state
		} else if let active = notification.object as? Bool {
			recordingChrome = active ? .recording : .idle
		}
		updateRecordingUI()
	}

	private func updateRecordingUI() {
		updateRecordingItem()
		updateMenuBarIcon()
		updateDockIcon()
	}

	private func updateMenuBarIcon() {
		guard let button = statusItem?.button else {
			testMenuBarImageIsMarked = recordingChrome != .idle
			return
		}
		if let base = baseMenuImage {
			base.size = NSSize(width: 18, height: 18)
			button.image = base
		}
		RecordingIndicatorOverlay.apply(
			to: button,
			color: RecordingIndicatorOverlay.color(for: recordingChrome),
			dotFraction: RecordingIndicatorOverlay.menuBarDotFraction,
		)
		button.toolTip = menuBarRecordingTooltip
		button.setAccessibilityValue(menuBarRecordingTooltip)
	}

	private var menuBarRecordingTooltip: String? {
		switch recordingChrome {
		case .idle: nil
		case .recording: "Recording"
		case .processing: "Processing Recording"
		}
	}

	private func updateDockIcon() {
		// Dock indicator should work even when the menu bar icon is hidden.
		guard managesAppChrome else { return }
		RecordingIndicatorOverlay.applyToDockTile(
			color: RecordingIndicatorOverlay.color(for: recordingChrome),
		)
	}

	private func updateRecordingItem() {
		guard let menu else { return }
		guard let item = menu.item(withTag: Self.recordingItemTag) else { return }
		item.title = recordingItemTitle
		item.isEnabled = recordingChrome != .processing
		item.action = recordingChrome == .processing ? nil : #selector(toggleRecording)
		let symbol = switch recordingChrome {
		case .idle, .recording: "record.circle"
		case .processing: "hourglass"
		}
		item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
	}

	// MARK: - Internal (for testing)

	static let recordingItemTag = 1001

	/// Returns the current menu item titles in order (for testing).
	var menuItemTitles: [String] {
		guard let menu else { return [] }
		return menu.items.map(\.title)
	}

	/// Updates recording state (for testing).
	func setRecordingActive(_ active: Bool) {
		recordingChrome = active ? .recording : .idle
		updateRecordingUI()
	}

	func setRecordingChrome(_ state: RecordingChromeState) {
		recordingChrome = state
		updateRecordingUI()
	}

	/// Whether the menu bar extra currently has the recording overlay attached.
	/// Returns `nil` if no image is set. (for testing)
	var menuBarImageIsMarked: Bool? {
		guard let button = statusItem?.button else { return testMenuBarImageIsMarked }
		guard button.image != nil || baseMenuImage != nil else { return nil }
		return RecordingIndicatorOverlay.isInstalled(on: button)
	}

	/// Whether the status item still shows the original template image. (for testing)
	var menuBarKeepsBaseImage: Bool {
		guard let image = statusItem?.button?.image, let base = baseMenuImage else { return false }
		return image === base
	}

	/// Whether the live status item image is still a template. (for testing)
	var statusItemButtonImageIsTemplate: Bool {
		statusItem?.button?.image?.isTemplate == true
	}

	/// Whether the Dock tile currently has the recording overlay content view. (for testing)
	var dockImageIsMarked: Bool {
		guard managesAppChrome else { return false }
		return RecordingIndicatorOverlay.isInstalledOnDock
	}
}
