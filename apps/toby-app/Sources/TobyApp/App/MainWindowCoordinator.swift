import AppKit

/// Lets non-view code (the companion head, menus) bring the main window forward.
/// RootView registers its window on appear via `WindowAccessor`.
@MainActor
final class MainWindowCoordinator {
	static let shared = MainWindowCoordinator()
	private init() {}

	/// Weak: SwiftUI releases the window when the user closes it.
	weak var window: NSWindow?

	/// Activates Toby and shows the main window, restoring it if minimized. If the
	/// window was closed, asks the system to reopen the app, which makes the
	/// `WindowGroup` create a fresh one.
	func bringToFront() {
		NSApp.activate(ignoringOtherApps: true)
		if let window {
			if window.isMiniaturized { window.deminiaturize(nil) }
			window.makeKeyAndOrderFront(nil)
		} else {
			NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL,
				configuration: NSWorkspace.OpenConfiguration())
		}
	}
}
