import AppKit
import Foundation

enum ClipboardCommands {
	static func readData() throws -> [String: Any] {
		let pasteboard = NSPasteboard.general
		guard let content = pasteboard.string(forType: .string) else {
			let types = pasteboard.types?.map { $0.rawValue } ?? []
			if types.isEmpty {
				return ["text": "", "hasContent": false, "types": []]
			}
			return ["text": "", "hasContent": true, "types": types]
		}
		let types = pasteboard.types?.map { $0.rawValue } ?? []
		return [
			"text": content,
			"hasContent": true,
			"types": types,
		]
	}

	static func writeData(text: String) throws -> [String: Any] {
		guard !text.isEmpty else {
			throw HelperError.usage("Clipboard text must not be empty")
		}
		let pasteboard = NSPasteboard.general
		pasteboard.clearContents()
		pasteboard.setString(text, forType: .string)
		return ["written": true]
	}
}
