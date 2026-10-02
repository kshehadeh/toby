import Foundation

/// Splits an AI step's user prompt into the instructions a person writes and
/// the step data it reads (`{{json bag.key}}` lines), so the editor can show
/// "What should AI do?" as plain text and the data as toggle chips.
///
/// Nothing here rewrites a prompt the person has not touched: the editor only
/// calls `compose` (or `including` / `excluding`) after an edit.
struct FlowPromptComposer: Equatable {
	struct DataItem: Equatable {
		let key: String
		/// The token exactly as written, e.g. `{{dashboardItems bag.tasks}}`.
		let token: String
		/// Short heading line written above the token, without the colon.
		let label: String?
	}

	var instructions: String
	var items: [DataItem]
	/// True when the data came before the instructions in the original prompt.
	var dataFirst: Bool

	var keys: [String] { items.map(\.key) }

	/// Nil when the prompt can't be split safely: a data token sits inside a
	/// sentence, a key appears twice, or the prompt uses `{{inputs.…}}`. The
	/// editor then shows the prompt as written.
	static func parse(_ prompt: String) -> FlowPromptComposer? {
		if prompt.contains("{{inputs.") { return nil }
		let lines = prompt.components(separatedBy: "\n")
		var instructionLines: [(index: Int, text: String)] = []
		var items: [DataItem] = []
		var firstDataLine: Int?

		for (index, line) in lines.enumerated() {
			if let key = fullLineKey(line) {
				if items.contains(where: { $0.key == key }) { return nil }
				var label: String?
				var startLine = index
				if let previous = instructionLines.last,
					previous.index == index - 1,
					let heading = headingText(previous.text)
				{
					label = heading
					startLine = previous.index
					instructionLines.removeLast()
				}
				items.append(DataItem(key: key, token: line.trimmingCharacters(in: .whitespaces), label: label))
				if firstDataLine == nil { firstDataLine = startLine }
			} else {
				if containsToken(line) { return nil }
				instructionLines.append((index, line))
			}
		}

		let firstInstructionLine = instructionLines.first(where: {
			!$0.text.trimmingCharacters(in: .whitespaces).isEmpty
		})?.index
		let dataFirst: Bool
		if let firstDataLine, let firstInstructionLine {
			dataFirst = firstDataLine < firstInstructionLine
		} else {
			dataFirst = false
		}

		return FlowPromptComposer(
			instructions: tidy(instructionLines.map(\.text).joined(separator: "\n")),
			items: items,
			dataFirst: dataFirst
		)
	}

	func compose() -> String {
		let block = items
			.map { item in (item.label.map { "\($0):\n" } ?? "") + item.token }
			.joined(separator: "\n\n")
		let instructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
		let parts = dataFirst ? [block, instructions] : [instructions, block]
		return parts.filter { !$0.isEmpty }.joined(separator: "\n\n")
	}

	func including(key: String, label: String) -> FlowPromptComposer {
		guard !keys.contains(key) else { return self }
		var copy = self
		copy.items.append(DataItem(key: key, token: FlowPromptComposer.token(for: key), label: label))
		return copy
	}

	func excluding(key: String) -> FlowPromptComposer {
		var copy = self
		copy.items.removeAll { $0.key == key }
		return copy
	}

	static func token(for key: String) -> String {
		"{{json bag.\(key)}}"
	}

	/// Keys referenced anywhere in a prompt, in order of first use.
	static func referencedKeys(in prompt: String) -> [String] {
		var keys: [String] = []
		for match in tokenRegex.matches(in: prompt, range: NSRange(prompt.startIndex..., in: prompt)) {
			guard let range = Range(match.range(at: 1), in: prompt) else { continue }
			let key = String(prompt[range])
			if !keys.contains(key) { keys.append(key) }
		}
		return keys
	}

	/// Raw-mode toggle off: drops every token for `key` (and a heading line
	/// directly above one) without touching the rest of the prompt.
	static func removingReferences(to key: String, from prompt: String) -> String {
		var lines = prompt.components(separatedBy: "\n")
		var index = 0
		while index < lines.count {
			if fullLineKey(lines[index]) == key {
				lines.remove(at: index)
				if index > 0, headingText(lines[index - 1]) != nil {
					lines.remove(at: index - 1)
					index -= 1
				}
				continue
			}
			index += 1
		}
		var joined = lines.joined(separator: "\n")
		let escaped = NSRegularExpression.escapedPattern(for: key)
		if let inline = try? NSRegularExpression(pattern: "\\{\\{\\s*(?:(?:json|dashboardItems)\\s+)?bag\\.\(escaped)\\s*\\}\\}") {
			joined = inline.stringByReplacingMatches(
				in: joined,
				range: NSRange(joined.startIndex..., in: joined),
				withTemplate: ""
			)
		}
		return tidy(joined)
	}

	/// Raw-mode toggle on: appends a labeled data block to the end.
	static func appendingReference(to key: String, label: String, in prompt: String) -> String {
		let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
		let block = "\(label):\n\(token(for: key))"
		return trimmed.isEmpty ? block : "\(trimmed)\n\n\(block)"
	}

	// MARK: - Parsing helpers

	private static let tokenRegex = try! NSRegularExpression(
		pattern: "\\{\\{\\s*(?:(?:json|dashboardItems)\\s+)?bag\\.([A-Za-z0-9_]+)\\s*\\}\\}"
	)
	private static let fullLineRegex = try! NSRegularExpression(
		pattern: "^\\s*\\{\\{\\s*(?:(?:json|dashboardItems)\\s+)?bag\\.([A-Za-z0-9_]+)\\s*\\}\\}\\s*$"
	)

	private static func fullLineKey(_ line: String) -> String? {
		let range = NSRange(line.startIndex..., in: line)
		guard let match = fullLineRegex.firstMatch(in: line, range: range),
			let keyRange = Range(match.range(at: 1), in: line)
		else { return nil }
		return String(line[keyRange])
	}

	private static func containsToken(_ line: String) -> Bool {
		tokenRegex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) != nil
	}

	/// A short line ending in ":" right above a data token, e.g. "Open tasks:".
	private static func headingText(_ line: String) -> String? {
		let trimmed = line.trimmingCharacters(in: .whitespaces)
		guard trimmed.hasSuffix(":"), !trimmed.contains("{{") else { return nil }
		let text = String(trimmed.dropLast()).trimmingCharacters(in: .whitespaces)
		guard !text.isEmpty else { return nil }
		let words = text.split(whereSeparator: \.isWhitespace)
		return words.count <= 6 ? text : nil
	}

	private static func tidy(_ text: String) -> String {
		var lines = text.components(separatedBy: "\n").map { line -> String in
			var trimmedEnd = line
			while trimmedEnd.last == " " || trimmedEnd.last == "\t" { trimmedEnd.removeLast() }
			return trimmedEnd
		}
		var collapsed: [String] = []
		for line in lines {
			if line.isEmpty, collapsed.last?.isEmpty == true { continue }
			collapsed.append(line)
		}
		lines = collapsed
		return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
	}
}
