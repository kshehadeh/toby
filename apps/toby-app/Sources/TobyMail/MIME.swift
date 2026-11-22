import Foundation

/// RFC 822/2045/2047 parsing: headers, encoded words, transfer encodings,
/// charsets, and multipart bodies.
public enum MIME {
	// MARK: Headers

	/// Unfolded headers, lowercased names, first occurrence wins.
	public static func headers(_ block: String) -> [String: String] {
		var out: [String: String] = [:]
		// "\r\n" is one Character, so normalize before line-based regexes.
		let unfolded = block.replacingOccurrences(of: "\r\n", with: "\n").replacing(/\n[ \t]+/, with: " ")
		for line in unfolded.split(whereSeparator: \.isNewline) {
			guard let colon = line.firstIndex(of: ":"), colon != line.startIndex else { continue }
			let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
			let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
			if !name.isEmpty, out[name] == nil { out[name] = value }
		}
		return out
	}

	/// Split a message into its header block and body.
	public static func split(_ data: Data) -> (header: String, body: Data) {
		let bytes = [UInt8](data)
		var index = 0
		while index + 1 < bytes.count {
			if bytes[index] == 10, bytes[index + 1] == 10 { return (latin(Data(bytes[..<index])), Data(bytes[(index + 2)...])) }
			if index + 3 < bytes.count, bytes[index] == 13, bytes[index + 1] == 10, bytes[index + 2] == 13, bytes[index + 3] == 10 {
				return (latin(Data(bytes[..<index])), Data(bytes[(index + 4)...]))
			}
			index += 1
		}
		return (latin(data), Data())
	}

	/// Header bytes as text: UTF-8 when valid (RFC 6532), otherwise Latin-1.
	static func latin(_ data: Data) -> String {
		String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
	}

	/// `type/subtype` plus lowercased parameters.
	public static func contentType(_ raw: String?) -> (type: String, params: [String: String]) {
		guard let raw, !raw.isEmpty else { return ("text/plain", [:]) }
		let parts = splitParams(raw)
		var params: [String: String] = [:]
		for part in parts.dropFirst() {
			guard let eq = part.firstIndex(of: "=") else { continue }
			let key = part[..<eq].trimmingCharacters(in: .whitespaces).lowercased()
			var value = part[part.index(after: eq)...].trimmingCharacters(in: .whitespaces)
			if value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 { value = String(value.dropFirst().dropLast()) }
			params[key.hasSuffix("*") ? String(key.dropLast()) : key] = value
		}
		return (parts.first?.trimmingCharacters(in: .whitespaces).lowercased() ?? "text/plain", params)
	}

	static func splitParams(_ raw: String) -> [String] {
		var parts: [String] = []
		var current = ""
		var quoted = false
		for char in raw {
			if char == "\"" { quoted.toggle() }
			if char == ";", !quoted { parts.append(current); current = "" } else { current.append(char) }
		}
		parts.append(current)
		return parts
	}

	// MARK: Encoded words (RFC 2047)

	nonisolated(unsafe) static let encodedWord = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/

	public static func decodeWords(_ raw: String) -> String {
		guard raw.contains("=?") else { return raw }
		// Whitespace between adjacent encoded words is dropped.
		let joined = raw.replacing(/(\?=)\s+(=\?)/, with: { "\($0.1)\($0.2)" })
		return joined.replacing(encodedWord) { match in
			let charset = String(match.1)
			let payload = String(match.3)
			let data: Data? = match.2.uppercased() == "B"
				? Data(base64Encoded: padded(payload))
				: quotedPrintable(Data(payload.replacingOccurrences(of: "_", with: " ").utf8), header: true)
			return data.map { decode($0, charset: charset) } ?? String(match.0)
		}
	}

	static func padded(_ base64: String) -> String {
		var text = base64.filter { !$0.isWhitespace }
		while text.count % 4 != 0 { text += "=" }
		return text
	}

	/// Encode a header value as an RFC 2047 word when it isn't plain ASCII.
	public static func encodeWord(_ value: String) -> String {
		value.unicodeScalars.allSatisfy { $0.isASCII && $0.value >= 32 } ? value : "=?UTF-8?B?\(Data(value.utf8).base64EncodedString())?="
	}

	// MARK: Transfer encodings and charsets

	public static func quotedPrintable(_ data: Data, header: Bool = false) -> Data {
		let bytes = [UInt8](data)
		var out: [UInt8] = []
		out.reserveCapacity(bytes.count)
		var index = 0
		func hex(_ byte: UInt8) -> UInt8? {
			switch byte {
			case 48 ... 57: byte - 48
			case 65 ... 70: byte - 55
			case 97 ... 102: byte - 87
			default: nil
			}
		}
		while index < bytes.count {
			let byte = bytes[index]
			if byte == 61 {
				if index + 1 < bytes.count, bytes[index + 1] == 10 { index += 2; continue }
				if index + 2 < bytes.count, bytes[index + 1] == 13, bytes[index + 2] == 10 { index += 3; continue }
				if index + 2 < bytes.count, let hi = hex(bytes[index + 1]), let lo = hex(bytes[index + 2]) {
					out.append(hi << 4 | lo)
					index += 3
					continue
				}
			}
			out.append(byte)
			index += 1
		}
		return Data(out)
	}

	public static func decode(_ data: Data, charset: String?) -> String {
		let name = (charset ?? "utf-8").trimmingCharacters(in: .whitespaces).lowercased()
		if name == "utf-8" || name == "utf8" || name == "us-ascii" { return String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self) }
		let cf = CFStringConvertIANACharSetNameToEncoding(name as CFString)
		if cf != kCFStringEncodingInvalidId {
			let encoding = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))
			if let text = String(data: data, encoding: encoding) { return text }
		}
		return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
	}

	static func transferDecode(_ data: Data, encoding: String?) -> Data {
		switch encoding?.trimmingCharacters(in: .whitespaces).lowercased() {
		case "base64": Data(base64Encoded: padded(String(decoding: data, as: UTF8.self))) ?? Data()
		case "quoted-printable": quotedPrintable(data)
		default: data
		}
	}

	// MARK: Bodies

	public struct Body: Sendable, Equatable {
		public var text: String
		public var html: String
	}

	/// The first inline `text/plain` and `text/html` parts. Text falls back to
	/// the HTML rendered as plain text.
	public static func body(of message: Data) -> Body {
		var text: String?
		var html: String?
		walk(message, text: &text, html: &html, depth: 0)
		let htmlBody = html ?? ""
		return Body(text: text ?? (htmlBody.isEmpty ? "" : htmlToText(htmlBody)), html: htmlBody)
	}

	static func walk(_ part: Data, text: inout String?, html: inout String?, depth: Int) {
		guard depth < 12 else { return }
		let (headerBlock, body) = split(part)
		let headers = headers(headerBlock)
		let (type, params) = contentType(headers["content-type"])
		let disposition = headers["content-disposition"]?.lowercased() ?? ""
		if type.hasPrefix("multipart/"), let boundary = params["boundary"] {
			for child in parts(body, boundary: boundary) { walk(child, text: &text, html: &html, depth: depth + 1) }
			return
		}
		guard !disposition.hasPrefix("attachment") else { return }
		if type == "text/plain", text == nil {
			text = decode(transferDecode(body, encoding: headers["content-transfer-encoding"]), charset: params["charset"])
		} else if type == "text/html", html == nil {
			html = decode(transferDecode(body, encoding: headers["content-transfer-encoding"]), charset: params["charset"])
		}
	}

	public static func parts(_ body: Data, boundary: String) -> [Data] {
		let delimiter = Data("--\(boundary)".utf8)
		var parts: [Data] = []
		var searchStart = body.startIndex
		var partStart: Data.Index?
		while let range = body.range(of: delimiter, in: searchStart ..< body.endIndex) {
			let atLineStart = range.lowerBound == body.startIndex || body[range.lowerBound - 1] == 10
			guard atLineStart else { searchStart = range.upperBound; continue }
			if let start = partStart {
				var end = range.lowerBound
				if end > start, body[end - 1] == 10 { end -= 1 }
				if end > start, body[end - 1] == 13 { end -= 1 }
				parts.append(Data(body[start ..< end]))
			}
			let closing = body[range.upperBound...].starts(with: Data("--".utf8))
			if closing { return parts }
			var next = range.upperBound
			while next < body.endIndex, body[next] != 10 { next += 1 }
			partStart = min(body.endIndex, next + 1)
			searchStart = partStart!
		}
		if let start = partStart, start < body.endIndex { parts.append(Data(body[start...])) }
		return parts
	}

	/// Rough HTML → text: drop head/script/style, keep line structure.
	public static func htmlToText(_ html: String) -> String {
		var text = html.replacing(/(?is)<(head|script|style)[^>]*>.*?<\/\1>/, with: "")
		text = text.replacing(/(?i)<br\s*\/?>/, with: "\n")
		text = text.replacing(/(?i)<\/(p|div|tr|li|h[1-6]|table|blockquote)>/, with: "\n")
		text = text.replacing(/(?i)<li[^>]*>/, with: "• ")
		text = text.replacing(/<[^>]+>/, with: "")
		let entities = ["&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…"]
		for (entity, value) in entities { text = text.replacingOccurrences(of: entity, with: value) }
		text = text.replacing(/&#(\d+);/) { match in Int(match.1).flatMap(UnicodeScalar.init).map { String(Character($0)) } ?? "" }
		let lines = text.components(separatedBy: .newlines).map { $0.replacing(/[ \t]+/, with: " ").trimmingCharacters(in: .whitespaces) }
		var out: [String] = []
		for line in lines where !(line.isEmpty && (out.last?.isEmpty ?? true)) { out.append(line) }
		return out.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
	}

	// MARK: Addresses

	public struct Address: Sendable, Equatable {
		public var name: String?
		public var email: String
		public init(name: String?, email: String) {
			self.name = name
			self.email = email
		}

		/// `Name <a@b.c>` or `a@b.c` (the plugin's display form).
		public var display: String { name.map { "\($0) <\(email)>" } ?? email }
	}

	/// The bare address in `Name <a@b>` or `a@b`.
	public static func bareAddress(_ raw: String) -> String {
		if let match = raw.firstMatch(of: /<([^<>]+)>/) { return String(match.1).trimmingCharacters(in: .whitespaces) }
		return raw.trimmingCharacters(in: .whitespacesAndNewlines)
	}
}
