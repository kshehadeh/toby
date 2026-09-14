import AppKit

/// Helpers for AppKit focus handoff from SwiftUI selection changes.
enum AppKitFocus {
	/// Resign an `NSTextView` first responder before SwiftUI removes it.
	/// Use `NSApplication.shared` — `NSApp` is nil in unit tests.
	@MainActor
	static func resignTextViewIfNeeded() {
		if let window = NSApplication.shared.keyWindow,
			window.firstResponder is NSTextView
		{
			window.makeFirstResponder(nil)
		}
	}
}
