import AppKit
import SwiftUI

/// Manages the system-wide menubar status item for Toby.
/// Provides quick access to new chat, recording toggle, and window opening.
@MainActor
final class MenuBarController: NSObject {
	private var statusItem: NSStatusItem?
	private(set) var menu: NSMenu?
	private var isRecordingActive = false
	private var baseMenuImage: NSImage?
	private var originalDockImage: NSImage?
	private var appliedDockIndicatorImage: NSImage?
	private var testMenuBarImageIsMarked = false
	/// When false, skip creating a real status item and updating dock chrome (tests).
	private let managesAppChrome: Bool

	static let recordingStateChanged = Notification.Name("menuBarRecordingStateChanged")
	private static let recordingDockImageName = NSImage.Name("TobyRecordingDockIndicator")

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
		if let logoURL = Bundle.tobyResources.url(forResource: "toby-128", withExtension: "png"),
			let logo = NSImage(contentsOf: logoURL)
		{
			let size = NSSize(width: 22, height: 22)
			logo.size = size
			// Full-color logo art — not a monochrome alpha glyph. Template mode
			// turns the opaque regions into a solid black/white box.
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
			recordingItem(),
			.separator(),
			dashboardItem(),
			chatsItem(),
			integrationsItem(),
			projectsItem(),
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
		viewMenuItem(title: DetailRoute.integrations.menuTitle, route: .integrations, keyEquivalent: "3")
	}

	private func projectsItem() -> NSMenuItem {
		viewMenuItem(title: DetailRoute.projects.menuTitle, route: .projects, keyEquivalent: "4")
	}

	private func skillsItem() -> NSMenuItem {
		viewMenuItem(title: DetailRoute.skills.menuTitle, route: .skills, keyEquivalent: "5")
	}

	private func memoriesItem() -> NSMenuItem {
		viewMenuItem(title: DetailRoute.memories.menuTitle, route: .memories, keyEquivalent: "6")
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
		updateRecordingUI()
	}

	private func updateRecordingUI() {
		updateRecordingItem()
		updateMenuBarIcon()
		updateDockIcon()
	}

	private func updateMenuBarIcon() {
		guard statusItem != nil else {
			testMenuBarImageIsMarked = isRecordingActive
			return
		}
		guard let base = baseMenuImage else { return }
		let image = isRecordingActive
			? Self.imageWithRecordingIndicator(base)
			: base
		image.size = NSSize(width: 22, height: 22)
		statusItem?.button?.image = image
	}

	private func updateDockIcon() {
		// Dock indicator should work even when the menu bar icon is hidden.
		guard managesAppChrome else { return }
		if isRecordingActive {
			if originalDockImage == nil {
				let current = NSApp.applicationIconImage
				if current?.name() != Self.recordingDockImageName {
					originalDockImage = current
				}
			}
			let base = originalDockImage ?? Self.cleanDockFallbackImage() ?? baseMenuImage ?? NSImage()
			let image = Self.imageWithRecordingIndicator(base, dotFraction: 0.4)
			image.setName(Self.recordingDockImageName)
			appliedDockIndicatorImage = image
			NSApp.applicationIconImage = image
		} else {
			restoreDockIcon()
		}
	}

	private func restoreDockIcon() {
		// Clear the marker name before restoring so later state checks do not
		// treat the clean base image as an active recording indicator.
		if let originalDockImage {
			let restored = originalDockImage.copy() as? NSImage
			restored?.setName(nil)
			NSApp.applicationIconImage = restored
		} else if let fallback = Self.cleanDockFallbackImage() {
			NSApp.applicationIconImage = fallback
		} else {
			// Setting to nil restores the bundle's AppIcon.icns.
			NSApp.applicationIconImage = nil
		}
		originalDockImage = nil
		appliedDockIndicatorImage = nil
	}

	private static func cleanDockFallbackImage() -> NSImage? {
		guard let logoURL = Bundle.tobyResources.url(forResource: "toby-128", withExtension: "png"),
			let image = NSImage(contentsOf: logoURL)
		else {
			return nil
		}
		image.setName(nil)
		return image
	}

	/// Composites a small red circle indicator at the bottom-right of `image`.
	private static func imageWithRecordingIndicator(_ image: NSImage, dotFraction: CGFloat = 0.45) -> NSImage {
		let result = image.copy() as! NSImage
		result.lockFocus()
		let size = result.size
		let radius = min(size.width, size.height) * dotFraction * 0.5
		let dotRect = NSRect(
			x: size.width - radius * 1.6,
			y: size.height - radius * 1.6,
			width: radius * 1.2,
			height: radius * 1.2
		)
		NSColor.systemRed.setFill()
		NSBezierPath(ovalIn: dotRect).fill()
		NSColor.white.withAlphaComponent(0.9).setStroke()
		let border = NSBezierPath(ovalIn: dotRect.insetBy(dx: -1, dy: -1))
		border.lineWidth = 1
		border.stroke()
		result.unlockFocus()
		return result
	}

	private func updateRecordingItem() {
		guard let menu else { return }
		guard let item = menu.item(withTag: Self.recordingItemTag) else { return }
		item.title = recordingItemTitle
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
		isRecordingActive = active
		updateRecordingUI()
	}

	/// Whether the current menu bar status item image has the recording indicator
	/// overlay applied. Returns `nil` if no image is set. (for testing)
	var menuBarImageIsMarked: Bool? {
		guard statusItem != nil else { return testMenuBarImageIsMarked }
		guard let current = statusItem?.button?.image, let base = baseMenuImage else { return nil }
		// The indicator image is a different instance than the base
		return current !== base
	}

	/// Whether the current Dock icon image has the recording indicator overlay
	/// applied. (for testing)
	var dockImageIsMarked: Bool {
		appliedDockIndicatorImage != nil
	}
}
