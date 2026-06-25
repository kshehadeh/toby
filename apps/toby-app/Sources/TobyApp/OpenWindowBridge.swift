import SwiftUI

/// Bridges SwiftUI's `openWindow` environment action to non-view code (e.g. MenuBarController).
/// RootView populates the closure on appear so the menubar can open named windows.
@MainActor
final class OpenWindowBridge {
	static let shared = OpenWindowBridge()
	private init() {}

	var openWindow: ((String) -> Void)?
}
