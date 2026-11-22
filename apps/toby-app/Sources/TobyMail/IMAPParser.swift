import Foundation

/// One IMAP response token tree: atoms, strings (quoted or literal), NIL, lists.
public indirect enum IMAPValue: Sendable, Equatable {
	case atom(String)
	case string(Data)
	case `nil`
	case list([IMAPValue])

	public var text: String? {
		switch self {
		case let .atom(value): value
		case let .string(data): String(decoding: data, as: UTF8.self)
		case .nil, .list: nil
		}
	}

	public var data: Data? {
		switch self {
		case let .string(data): data
		case let .atom(value): Data(value.utf8)
		case .nil, .list: nil
		}
	}

	public var list: [IMAPValue]? { if case let .list(items) = self { items } else { nil } }
	public var number: Int? { text.flatMap { Int($0) } }
}

/// Tokenizes a full IMAP response (literals inlined as `{n}\r\n<bytes>`).
public struct IMAPParser {
	let bytes: [UInt8]
	var index = 0

	public init(_ data: Data) { bytes = Array(data) }

	public static func parse(_ data: Data) -> [IMAPValue] {
		var parser = IMAPParser(data)
		var values: [IMAPValue] = []
		while let value = parser.next() { values.append(value) }
		return values
	}

	mutating func skipSpaces() {
		while index < bytes.count, bytes[index] == 32 || bytes[index] == 13 || bytes[index] == 10 { index += 1 }
	}

	public mutating func next() -> IMAPValue? {
		skipSpaces()
		guard index < bytes.count else { return nil }
		switch bytes[index] {
		case 40: // (
			index += 1
			var items: [IMAPValue] = []
			while true {
				skipSpaces()
				if index >= bytes.count { break }
				if bytes[index] == 41 { index += 1; break }
				guard let value = next() else { break }
				items.append(value)
			}
			return .list(items)
		case 41: // stray )
			index += 1
			return next()
		case 34: // "
			index += 1
			var out: [UInt8] = []
			while index < bytes.count, bytes[index] != 34 {
				if bytes[index] == 92, index + 1 < bytes.count { index += 1 }
				out.append(bytes[index])
				index += 1
			}
			index += 1
			return .string(Data(out))
		case 123: // {n}
			var cursor = index + 1
			var digits: [UInt8] = []
			while cursor < bytes.count, bytes[cursor] != 125 { digits.append(bytes[cursor]); cursor += 1 }
			let count = Int(String(decoding: digits.filter { $0 != 43 }, as: UTF8.self)) ?? 0
			cursor += 1
			if cursor + 1 < bytes.count, bytes[cursor] == 13, bytes[cursor + 1] == 10 { cursor += 2 }
			let end = min(bytes.count, cursor + count)
			index = end
			return .string(Data(bytes[cursor ..< end]))
		default:
			var out: [UInt8] = []
			var depth = 0
			while index < bytes.count {
				let byte = bytes[index]
				if depth == 0, byte == 32 || byte == 40 || byte == 41 || byte == 13 || byte == 10 { break }
				if byte == 91 { depth += 1 } else if byte == 93 { depth = max(0, depth - 1) }
				out.append(byte)
				index += 1
			}
			let atom = String(decoding: out, as: UTF8.self)
			return atom.uppercased() == "NIL" ? .nil : .atom(atom)
		}
	}

	/// A response line ending with a literal marker (`{123}` / `{123+}`).
	static func literalLength(_ line: Data) -> Int? {
		guard line.last == 125, let open = line.lastIndex(of: 123) else { return nil }
		let digits = line[(open + 1) ..< (line.endIndex - 1)].filter { $0 != 43 }
		return Int(String(decoding: digits, as: UTF8.self))
	}
}

// MARK: Helpers

public enum IMAPEncoding {
	/// Quote a command argument (literals are handled by `IMAPClient`).
	public static func quoted(_ value: String) -> String {
		"\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
	}

	/// Whether a string must be sent as a literal.
	public static func needsLiteral(_ value: String) -> Bool {
		value.utf8.contains { $0 > 126 || $0 == 13 || $0 == 10 || $0 == 0 }
	}

	/// Compact a UID list into a sequence set (`1:3,7`).
	public static func sequenceSet(_ uids: [Int]) -> String {
		let sorted = Array(Set(uids)).sorted()
		var parts: [String] = []
		var index = 0
		while index < sorted.count {
			var end = index
			while end + 1 < sorted.count, sorted[end + 1] == sorted[end] + 1 { end += 1 }
			parts.append(end == index ? "\(sorted[index])" : "\(sorted[index]):\(sorted[end])")
			index = end + 1
		}
		return parts.joined(separator: ",")
	}

	/// Modified UTF-7 (RFC 3501 §5.1.3) → String.
	public static func decodeMailboxName(_ name: String) -> String {
		var out = ""
		var rest = Substring(name)
		while let amp = rest.firstIndex(of: "&") {
			out += rest[..<amp]
			let after = rest[rest.index(after: amp)...]
			guard let dash = after.firstIndex(of: "-") else { out += rest[amp...]; return out }
			let encoded = after[..<dash]
			if encoded.isEmpty {
				out += "&"
			} else {
				var base64 = encoded.replacingOccurrences(of: ",", with: "/")
				while base64.count % 4 != 0 { base64 += "=" }
				if let data = Data(base64Encoded: base64), let text = String(data: data, encoding: .utf16BigEndian) { out += text } else { out += "&\(encoded)-" }
			}
			rest = after[after.index(after: dash)...]
		}
		return out + rest
	}

	/// String → modified UTF-7.
	public static func encodeMailboxName(_ name: String) -> String {
		var out = ""
		var pending: [UInt16] = []
		func flush() {
			guard !pending.isEmpty else { return }
			let data = pending.flatMap { [UInt8($0 >> 8), UInt8($0 & 0xFF)] }
			out += "&" + Data(data).base64EncodedString().replacingOccurrences(of: "=", with: "").replacingOccurrences(of: "/", with: ",") + "-"
			pending.removeAll()
		}
		for scalar in name.unicodeScalars {
			if scalar.value >= 0x20, scalar.value <= 0x7E {
				flush()
				out += scalar == "&" ? "&-" : String(scalar)
			} else {
				pending += Array(String(scalar).utf16)
			}
		}
		flush()
		return out
	}

	static let dateFormats = ["EEE, d MMM yyyy HH:mm:ss Z", "d MMM yyyy HH:mm:ss Z", "EEE, d MMM yyyy HH:mm Z", "d-MMM-yyyy HH:mm:ss Z", "EEE, d MMM yy HH:mm:ss Z"]

	/// RFC 2822 / IMAP INTERNALDATE → Date.
	public static func parseDate(_ raw: String) -> Date? {
		var text = raw.trimmingCharacters(in: .whitespaces)
		if let paren = text.range(of: " (") { text = String(text[..<paren.lowerBound]) }
		text = text.replacingOccurrences(of: "  ", with: " ")
		let zones = ["UT": "+0000", "GMT": "+0000", "UTC": "+0000", "EST": "-0500", "EDT": "-0400", "CST": "-0600", "CDT": "-0500", "MST": "-0700", "MDT": "-0600", "PST": "-0800", "PDT": "-0700", "Z": "+0000"]
		if let last = text.split(separator: " ").last, let offset = zones[String(last).uppercased()] {
			text = text.dropLast(last.count) + offset
		}
		let formatter = DateFormatter()
		formatter.locale = Locale(identifier: "en_US_POSIX")
		for format in dateFormats {
			formatter.dateFormat = format
			if let date = formatter.date(from: text) { return date }
		}
		return nil
	}
}
