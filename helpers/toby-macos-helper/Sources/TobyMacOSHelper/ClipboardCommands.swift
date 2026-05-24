import AppKit
import Foundation

enum ClipboardCommands {
	static func read() throws {
		let pasteboard = NSPasteboard.general
		guard let content = pasteboard.string(forType: .string) else {
			// No text content — may have images or other types
			let types = pasteboard.types?.map { $0.rawValue } ?? []
			if types.isEmpty {
				JSONOutput.success(["text": "", "hasContent": false, "types": []])
			} else {
				JSONOutput.success(["text": "", "hasContent": true, "types": types])
			}
			return
		}
		let types = pasteboard.types?.map { $0.rawValue } ?? []
		JSONOutput.success([
			"text": content,
			"hasContent": true,
			"types": types,
		])
	}

	static func write(_ parser: inout ArgParser) throws {
		let text: String
		if parser.parseFlag("--stdin") {
			// Read content from stdin to avoid ARG_MAX limits and null-byte truncation
			var input = ""
			while let line = readLine(strippingNewline: false) {
				input += line
			}
			guard !input.isEmpty else {
				throw HelperError.usage("--stdin requires non-empty content on stdin")
			}
			text = input
		} else if let argText = parser.parseValue("--text") {
			text = argText
		} else {
			throw HelperError.usage("--text <content> or --stdin is required")
		}
		let pasteboard = NSPasteboard.general
		pasteboard.clearContents()
		pasteboard.setString(text, forType: .string)
		JSONOutput.success(["written": true])
	}
}
