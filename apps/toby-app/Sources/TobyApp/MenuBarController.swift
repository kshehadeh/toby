import AppKit
import SwiftUI

/// Manages the system-wide menubar status item for Toby.
/// Provides quick access to new chat, recording toggle, and window opening.
@MainActor
final class MenuBarController: NSObject {
	private var statusItem: NSStatusItem?
	private var isRecordingActive = false

	static let recordingStateChanged = Notification.Name("menuBarRecordingStateChanged")

	override init() {
		super.init()
		setupStatusItem()
		observeRecordingState()
	}

	private func setupStatusItem() {
		let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
		if let logoURL = Bundle.tobyResources.url(forResource: "toby-128", withExtension: "png"),
			let logo = NSImage(contentsOf: logoURL)
		{
			let size = NSSize(width: 18, height: 18)
			logo.size = size
			item.button?.image = logo
		} else {
			item.button?.image = NSImage(
				systemSymbolName: "brain.head.profile",
				accessibilityDescription: "Toby"
			)
			item.button?.image?.isTemplate = true
		}
		item.menu = buildMenu()
		statusItem = item
	}

	private func buildMenu() -> NSMenu {
		let menu = NSMenu()
		menu.items = [
			newChatItem(),
			recordingItem(),
			.separator(),
			recordingsItem(),
			schedulesItem(),
			integrationsItem(),
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
		return item
	}

	private func recordingsItem() -> NSMenuItem {
		let item = NSMenuItem(
			title: "Recordings",
			action: #selector(openRecordings),
			keyEquivalent: ""
		)
		item.target = self
		return item
	}

	private func schedulesItem() -> NSMenuItem {
		let item = NSMenuItem(
			title: "Schedules",
			action: #selector(openSchedules),
			keyEquivalent: ""
		)
		item.target = self
		return item
	}

	private func integrationsItem() -> NSMenuItem {
		let item = NSMenuItem(
			title: "Integrations",
			action: #selector(openIntegrations),
			keyEquivalent: ""
		)
		item.target = self
		return item
	}

	private func settingsItem() -> NSMenuItem {
		let item = NSMenuItem(
			title: "Settings…",
			action: #selector(openSettings),
			keyEquivalent: ","
		)
		item.target = self
		item.keyEquivalentModifierMask = .command
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
		return item
	}

	// MARK: - Actions

	@objc private func postNewChat() {
		NotificationCenter.default.post(name: .startNewChat, object: nil)
	}

	@objc private func toggleRecording() {
		NotificationCenter.default.post(name: .menuBarToggleRecording, object: nil)
	}

	@objc private func openRecordings() {
		OpenWindowBridge.shared.openWindow?("recordings")
	}

	@objc private func openSchedules() {
		OpenWindowBridge.shared.openWindow?("schedules")
	}

	@objc private func openIntegrations() {
		OpenWindowBridge.shared.openWindow?("integrations")
	}

	@objc private func openSettings() {
		OpenWindowBridge.shared.openWindow?("settings")
	}

	@objc private func quitApp() {
		NSApp.terminate(nil)
	}

	// MARK: - Recording state

	private var recordingItemTitle: String {
		isRecordingActive ? "Stop Recording" : "Start Recording"
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
		if let active = notification.object as? Bool {
			isRecordingActive = active
		}
		updateRecordingItem()
	}

	private func updateRecordingItem() {
		guard let menu = statusItem?.menu else { return }
		guard let item = menu.item(withTag: Self.recordingItemTag) else { return }
		item.title = recordingItemTitle
	}

	// MARK: - Internal (for testing)

	static let recordingItemTag = 1001

	/// Returns the current menu item titles in order (for testing).
	var menuItemTitles: [String] {
		guard let menu = statusItem?.menu else { return [] }
		return menu.items.map(\.title)
	}

	/// Updates recording state (for testing).
	func setRecordingActive(_ active: Bool) {
		isRecordingActive = active
		updateRecordingItem()
	}
}
