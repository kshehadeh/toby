import AppKit
import Foundation
import SwiftUI

/// Builds a monospaced, lightly syntax-colored `AttributedString` for arbitrary JSON.
@MainActor
enum JSONPrettyPrinter {
	/// Pretty-print a JSONSerialization-compatible value, or fall back to plain text.
	static func attributedString(from value: Any?) -> AttributedString {
		guard let value else {
			return plain("—")
		}
		if JSONSerialization.isValidJSONObject(value),
		   let data = try? JSONSerialization.data(
		   	withJSONObject: value,
		   	options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
		   ),
		   let text = String(data: data, encoding: .utf8)
		{
			return highlight(prettyJSON: text)
		}
		if let text = scalarJSONString(value) {
			return highlight(prettyJSON: text)
		}
		return plain(String(describing: value))
	}

	static func attributedString(prettyJSON text: String) -> AttributedString {
		highlight(prettyJSON: text)
	}

	// MARK: - Private

	private static var font: NSFont {
		NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
	}

	private static var keyColor: NSColor { NSColor(red: 0.55, green: 0.75, blue: 0.98, alpha: 1) }
	private static var stringColor: NSColor { NSColor(red: 0.55, green: 0.85, blue: 0.55, alpha: 1) }
	private static var numberColor: NSColor { NSColor(red: 0.95, green: 0.75, blue: 0.40, alpha: 1) }
	private static var boolColor: NSColor { NSColor(red: 0.85, green: 0.55, blue: 0.95, alpha: 1) }
	private static var nullColor: NSColor { NSColor.white.withAlphaComponent(0.40) }
	private static var punctuationColor: NSColor { NSColor.white.withAlphaComponent(0.55) }
	private static var defaultColor: NSColor { NSColor.white.withAlphaComponent(0.88) }

	private static func plain(_ text: String) -> AttributedString {
		var result = AttributedString(text)
		result.font = .system(size: 11, design: .monospaced)
		result.foregroundColor = Color(nsColor: defaultColor)
		return result
	}

	private static func scalarJSONString(_ value: Any) -> String? {
		if let s = value as? String {
			if let data = try? JSONSerialization.data(withJSONObject: [s]),
			   let array = String(data: data, encoding: .utf8)
			{
				return String(array.dropFirst().dropLast())
			}
			return "\"\(s)\""
		}
		if let n = value as? NSNumber {
			if CFGetTypeID(n) == CFBooleanGetTypeID() {
				return n.boolValue ? "true" : "false"
			}
			return n.stringValue
		}
		if value is NSNull {
			return "null"
		}
		return nil
	}

	/// Lightweight tokenizer for already pretty-printed JSON text.
	private static func highlight(prettyJSON text: String) -> AttributedString {
		let ns = NSMutableAttributedString(string: text)
		let full = NSRange(location: 0, length: ns.length)
		ns.addAttribute(.font, value: font, range: full)
		ns.addAttribute(.foregroundColor, value: defaultColor, range: full)

		applyRegex(#"[{}\[\],:]"#, in: ns, color: punctuationColor)
		applyRegex(#""(?:\\.|[^"\\])*"(?=\s*:)"#, in: ns, color: keyColor)
		applyRegex(#""(?:\\.|[^"\\])*"(?!\s*:)"#, in: ns, color: stringColor)
		applyRegex(#"(?<=[:\s\[,])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?"#, in: ns, color: numberColor)
		applyRegex(#"\btrue\b|\bfalse\b"#, in: ns, color: boolColor)
		applyRegex(#"\bnull\b"#, in: ns, color: nullColor)

		return AttributedString(ns)
	}

	private static func applyRegex(_ pattern: String, in ns: NSMutableAttributedString, color: NSColor) {
		guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
		let full = NSRange(location: 0, length: ns.length)
		for match in regex.matches(in: ns.string, range: full) {
			ns.addAttribute(.foregroundColor, value: color, range: match.range)
		}
	}
}
