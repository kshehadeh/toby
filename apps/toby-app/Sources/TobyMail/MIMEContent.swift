import Foundation
import UniformTypeIdentifiers

/// Full message content for the email reader: both bodies, inline images, and
/// attachments. `MIME.body(of:)` stays the lighter path for chat and the cache.
extension MIME {
	public struct Attachment: Sendable, Equatable {
		public var filename: String
		public var mimeType: String
		/// `Content-ID` without angle brackets.
		public var contentID: String?
		public var data: Data
	}

	public struct Content: Sendable, Equatable {
		public var text: String
		/// HTML with `cid:` images inlined as `data:` URIs. Empty for plain-text mail.
		public var html: String
		public var attachments: [Attachment]
	}

	struct Rendered {
		var text: String?
		var html: String?
	}

	public static func content(of message: Data) -> Content {
		var files: [Attachment] = []
		let rendered = render(message, files: &files, depth: 0)
		var html = rendered.html ?? ""
		let attachments = inlineImages(files, in: &html)
		return Content(text: rendered.text ?? (html.isEmpty ? "" : htmlToText(html)), html: html, attachments: attachments)
	}

	static func render(_ part: Data, files: inout [Attachment], depth: Int) -> Rendered {
		guard depth < 12 else { return Rendered() }
		let (headerBlock, body) = split(part)
		let headers = headers(headerBlock)
		let (type, params) = contentType(headers["content-type"])
		if type.hasPrefix("multipart/"), let boundary = params["boundary"] {
			var children: [Rendered] = []
			for child in parts(body, boundary: boundary) { children.append(render(child, files: &files, depth: depth + 1)) }
			// Alternatives are ordered plainest first; the last HTML is the richest.
			if type == "multipart/alternative" { return Rendered(text: children.compactMap(\.text).first, html: children.compactMap(\.html).last) }
			return join(children)
		}
		let disposition = headers["content-disposition"]
		let dispositionName = filename(disposition, parameter: "filename")
		let data = transferDecode(body, encoding: headers["content-transfer-encoding"])
		let isAttachment = disposition?.lowercased().hasPrefix("attachment") == true || dispositionName != nil
		if !isAttachment, type == "text/plain" { return Rendered(text: decode(data, charset: params["charset"])) }
		if !isAttachment, type == "text/html" { return Rendered(html: decode(data, charset: params["charset"])) }
		// Detached signatures aren't files anyone opens.
		guard !["application/pgp-signature", "application/pkcs7-signature", "application/x-pkcs7-signature"].contains(type) else { return Rendered() }
		let name = dispositionName ?? filename(headers["content-type"], parameter: "name") ?? defaultFilename(type)
		let contentID = headers["content-id"]?.trimmingCharacters(in: CharacterSet(charactersIn: "<> \t"))
		files.append(Attachment(filename: safeFilename(name), mimeType: type, contentID: contentID?.isEmpty == false ? contentID : nil, data: data))
		return Rendered()
	}

	/// Sequential parts (`multipart/mixed`, `related`, …) read top to bottom.
	static func join(_ children: [Rendered]) -> Rendered {
		let bodies = children.filter { $0.text != nil || $0.html != nil }
		guard bodies.count > 1 else { return bodies.first ?? Rendered() }
		let text = bodies.map { $0.text ?? htmlToText($0.html ?? "") }.joined(separator: "\n\n")
		guard bodies.contains(where: { $0.html != nil }) else { return Rendered(text: text) }
		let html = bodies.map { $0.html ?? "<div style=\"white-space:pre-wrap\">\(escapeHTML($0.text ?? ""))</div>" }.joined(separator: "\n")
		return Rendered(text: text, html: html)
	}

	public static func escapeHTML(_ text: String) -> String {
		text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
	}

	/// Replace `cid:` references with `data:` URIs; returns the files that
	/// weren't used inline.
	static func inlineImages(_ files: [Attachment], in html: inout String) -> [Attachment] {
		guard html.range(of: "cid:", options: .caseInsensitive) != nil else { return files }
		var used = Set<String>()
		// Longest first so "image1" never rewrites part of "image10".
		for file in files.sorted(by: { ($0.contentID?.count ?? 0) > ($1.contentID?.count ?? 0) }) {
			guard let id = file.contentID, file.mimeType.hasPrefix("image/"), !used.contains(id) else { continue }
			let encoded = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? id
			for reference in Set([id, encoded]) where html.range(of: "cid:\(reference)", options: .caseInsensitive) != nil {
				html = html.replacingOccurrences(of: "cid:\(reference)", with: "data:\(file.mimeType);base64,\(file.data.base64EncodedString())", options: .caseInsensitive)
				used.insert(id)
			}
		}
		return files.filter { $0.contentID.map { !used.contains($0) } ?? true }
	}

	// MARK: Filenames

	/// A name that stays inside the folder it's saved to.
	public static func safeFilename(_ raw: String) -> String {
		let cleaned = String(String.UnicodeScalarView(raw.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }))
		let last = cleaned.split(whereSeparator: { "/\\:".contains($0) }).last.map(String.init) ?? ""
		let trimmed = String(last.trimmingCharacters(in: .whitespaces).drop { $0 == "." })
		return trimmed.isEmpty ? "Attachment" : String(trimmed.suffix(200))
	}

	static func defaultFilename(_ type: String) -> String {
		if type == "text/calendar" { return "invite.ics" }
		if type == "message/rfc822" { return "Message.eml" }
		let base = type.hasPrefix("image/") ? "Image" : "Attachment"
		return UTType(mimeType: type)?.preferredFilenameExtension.map { "\(base).\($0)" } ?? base
	}

	/// `filename="x"`, an RFC 2047 word, or RFC 2231 (`filename*=utf-8''x`,
	/// `filename*0*=…; filename*1=…`).
	static func filename(_ header: String?, parameter: String) -> String? {
		guard let header else { return nil }
		var values: [String: String] = [:]
		for part in splitParams(header).dropFirst() {
			guard let eq = part.firstIndex(of: "=") else { continue }
			var value = part[part.index(after: eq)...].trimmingCharacters(in: .whitespaces)
			if value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 { value = String(value.dropFirst().dropLast()) }
			values[part[..<eq].trimmingCharacters(in: .whitespaces).lowercased()] = value
		}
		if let extended = values["\(parameter)*"] { return decodeExtended([(extended, true)]) }
		var segments: [(String, Bool)] = []
		while true {
			let key = "\(parameter)*\(segments.count)"
			if let encoded = values["\(key)*"] { segments.append((encoded, true)) } else if let plain = values[key] { segments.append((plain, false)) } else { break }
		}
		if !segments.isEmpty { return decodeExtended(segments) }
		return values[parameter].map(decodeWords).flatMap { $0.isEmpty ? nil : $0 }
	}

	private static func decodeExtended(_ segments: [(value: String, encoded: Bool)]) -> String? {
		var charset = "utf-8"
		var data = Data()
		for (index, segment) in segments.enumerated() {
			var value = segment.value
			guard segment.encoded else { data.append(Data(value.utf8)); continue }
			if index == 0 {
				let pieces = value.split(separator: "'", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
				if pieces.count == 3 {
					if !pieces[0].isEmpty { charset = pieces[0] }
					value = pieces[2]
				}
			}
			// Percent escapes are bytes in `charset`; reuse the quoted-printable decoder.
			data.append(quotedPrintable(Data(value.replacingOccurrences(of: "=", with: "=3D").replacingOccurrences(of: "%", with: "=").utf8)))
		}
		let name = decode(data, charset: charset)
		return name.isEmpty ? nil : name
	}
}
