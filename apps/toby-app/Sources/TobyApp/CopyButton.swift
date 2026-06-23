import AppKit
import SwiftUI

/// A small icon button that copies the given text to the system pasteboard,
/// briefly showing a checkmark to confirm the copy succeeded.
struct CopyButton: View {
	let text: String
	let label: String
	@State private var didCopy = false

	var body: some View {
		Button {
			copyToClipboard()
		} label: {
			Image(systemName: didCopy ? "checkmark" : "square.on.square")
				.font(.caption)
		}
		.buttonStyle(.plain)
		.foregroundStyle(didCopy ? AppTheme.accent : AppTheme.tertiaryText)
		.help(didCopy ? "Copied" : label)
		.accessibilityLabel(didCopy ? "Copied" : label)
	}

	private func copyToClipboard() {
		let pasteboard = NSPasteboard.general
		pasteboard.clearContents()
		pasteboard.setString(text, forType: .string)
		didCopy = true
		DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
			didCopy = false
		}
	}
}
