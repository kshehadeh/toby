import AppKit
import CodeEditorView
import SwiftUI

/// Toby-branded syntax theme for `CodeEditorView`, built from the same
/// tokens as `NSColor+TobyTheme` (the log/JSON syntax family) rather than
/// the package's generic `.defaultDark` / `.defaultLight`. Keeps the script
/// editor's colors identical to every other place Toby colors code (log
/// pretty-printing, markdown code spans).
extension Theme {

	/// `colourScheme` picks which literal set below to use; call
	/// `Theme.toby(for:)` from a view's `\.colorScheme` rather than reading
	/// `.tobyDark` / `.tobyLight` directly so the cursor/selection colour
	/// always matches the user's *current* accent preset.
	static func toby(for colourScheme: ColorScheme) -> Theme {
		colourScheme == .dark ? tobyDark : tobyLight
	}

	static var tobyDark: Theme {
		let accent = NSColor(AccentPreset.current.color)
		return Theme(
			colourScheme: .dark,
			fontName: "SFMono-Medium",
			fontSize: 13.0,
			textColour: NSColor(white: 1.0, alpha: 0.88),        // --text-body (dark)
			commentColour: NSColor(white: 1.0, alpha: 0.38),     // --text-faint
			stringColour: NSColor(red: 0.55, green: 0.85, blue: 0.55, alpha: 1.0),   // --toby-json-string
			characterColour: NSColor(white: 1.0, alpha: 0.38),       // AppleScript # comment
			numberColour: NSColor(red: 0.95, green: 0.75, blue: 0.40, alpha: 1.0),   // --toby-json-number
			identifierColour: NSColor(white: 1.0, alpha: 0.88),  // plain identifiers stay body text
			operatorColour: NSColor(white: 1.0, alpha: 0.58),    // --text-muted
			keywordColour: NSColor(red: 0.85, green: 0.55, blue: 0.95, alpha: 1.0),  // --toby-json-bool
			symbolColour: NSColor(white: 1.0, alpha: 0.58),
			typeColour: NSColor(red: 0.55, green: 0.75, blue: 0.98, alpha: 1.0),     // --toby-json-key
			fieldColour: NSColor(red: 0.55, green: 0.75, blue: 0.98, alpha: 1.0),
			caseColour: NSColor(red: 0.55, green: 0.75, blue: 0.98, alpha: 1.0),
			backgroundColour: NSColor(red: 0.08, green: 0.08, blue: 0.09, alpha: 1.0), // --toby-log-bg
			currentLineColour: NSColor(red: 0.11, green: 0.11, blue: 0.12, alpha: 1.0),
			selectionColour: accent.withAlphaComponent(0.35),
			cursorColour: accent,
			invisiblesColour: NSColor(white: 1.0, alpha: 0.38)
		)
	}

	static var tobyLight: Theme {
		let accent = NSColor(AccentPreset.current.color)
		return Theme(
			colourScheme: .light,
			fontName: "SFMono-Medium",
			fontSize: 13.0,
			textColour: NSColor(white: 0.0, alpha: 0.88),        // --text-body (light)
			commentColour: NSColor(white: 0.0, alpha: 0.38),     // --text-faint
			stringColour: NSColor(red: 0.12, green: 0.48, blue: 0.28, alpha: 1.0),   // --toby-json-string
			characterColour: NSColor(white: 0.0, alpha: 0.38),       // AppleScript # comment
			numberColour: NSColor(red: 0.72, green: 0.38, blue: 0.05, alpha: 1.0),   // --toby-json-number
			identifierColour: NSColor(white: 0.0, alpha: 0.88),
			operatorColour: NSColor(white: 0.0, alpha: 0.55),    // --text-muted
			keywordColour: NSColor(red: 0.52, green: 0.22, blue: 0.68, alpha: 1.0),  // --toby-json-bool
			symbolColour: NSColor(white: 0.0, alpha: 0.55),
			typeColour: NSColor(red: 0.18, green: 0.32, blue: 0.68, alpha: 1.0),     // --toby-json-key
			fieldColour: NSColor(red: 0.18, green: 0.32, blue: 0.68, alpha: 1.0),
			caseColour: NSColor(red: 0.18, green: 0.32, blue: 0.68, alpha: 1.0),
			backgroundColour: NSColor(red: 0.97, green: 0.97, blue: 0.98, alpha: 1.0), // --toby-log-bg
			currentLineColour: NSColor(red: 0.94, green: 0.94, blue: 0.95, alpha: 1.0),
			selectionColour: accent.withAlphaComponent(0.28),
			cursorColour: accent,
			invisiblesColour: NSColor(white: 0.0, alpha: 0.38)
		)
	}
}
