import SwiftUI

struct MarkdownImage: Equatable {
	let alt: String
	let source: URL
	/// When the image is wrapped in a markdown link (`[![alt](src)](href)`), open this instead of `source`.
	let linkURL: URL?

	var openURL: URL {
		linkURL ?? source
	}

	var caption: String {
		alt.trimmingCharacters(in: .whitespacesAndNewlines)
	}
}

struct MarkdownTable: Equatable {
	let hasHeader: Bool
	let colCount: Int
	let cells: [[String]]
	let alignments: [TextAlignment]
}

struct MarkdownFileLink: Equatable {
	let label: String
	let destination: String

	var filename: String {
		Self.filename(from: destination)
	}

	func resolvedFileURL(generatedFilesDir: String = ConfigReader.generatedFilesDir()) -> URL? {
		Self.resolvedFileURL(destination: destination, generatedFilesDir: generatedFilesDir)
	}

	static let textFileExtensions: Set<String> = [
		"md", "markdown", "txt", "text", "json", "yaml", "yml",
		"csv", "tsv", "log", "xml", "html", "rst",
	]

	static func isFileDestination(_ raw: String) -> Bool {
		let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return false }
		let lower = trimmed.lowercased()
		if lower.hasPrefix("https://") || lower.hasPrefix("http://") { return false }
		if lower.hasPrefix("javascript:") || lower.hasPrefix("mailto:") || lower.hasPrefix("data:") {
			return false
		}
		guard let ext = fileExtension(from: trimmed), textFileExtensions.contains(ext) else {
			return false
		}
		if lower.hasPrefix("file:") { return true }
		if trimmed.hasPrefix("/") || trimmed.hasPrefix("~/") { return true }
		if trimmed.contains("://") { return false }
		if trimmed.contains("..") { return false }
		return true
	}

	static func filename(from destination: String) -> String {
		let trimmed = destination.trimmingCharacters(in: .whitespacesAndNewlines)
		if let url = URL(string: trimmed), url.isFileURL {
			let name = url.lastPathComponent
			if !name.isEmpty { return name }
		}
		let expanded = (trimmed as NSString).expandingTildeInPath
		let name = URL(fileURLWithPath: expanded).lastPathComponent
		return name.isEmpty ? "download" : name
	}

	static func resolvedFileURL(destination: String, generatedFilesDir: String) -> URL? {
		let trimmed = destination.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return nil }

		if let url = URL(string: trimmed), url.isFileURL {
			return url.standardizedFileURL
		}

		if trimmed.hasPrefix("~/") || trimmed.hasPrefix("/") {
			let expanded = (trimmed as NSString).expandingTildeInPath
			return URL(fileURLWithPath: expanded).standardizedFileURL
		}

		if trimmed.contains("://") || trimmed.contains("..") { return nil }

		let base = URL(fileURLWithPath: generatedFilesDir, isDirectory: true)
		return URL(fileURLWithPath: trimmed, relativeTo: base).standardizedFileURL
	}

	static func uniqueURL(
		in directory: URL,
		preferredFilename: String,
		fileExists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) },
	) -> URL {
		let preferred = preferredFilename.trimmingCharacters(in: .whitespacesAndNewlines)
		let fallback = preferred.isEmpty ? "download" : preferred
		let stem = URL(fileURLWithPath: fallback).deletingPathExtension().lastPathComponent
		let ext = URL(fileURLWithPath: fallback).pathExtension
		var n = 0
		while true {
			let name: String
			if n == 0 {
				name = ext.isEmpty ? stem : "\(stem).\(ext)"
			} else if ext.isEmpty {
				name = "\(stem) (\(n))"
			} else {
				name = "\(stem) (\(n)).\(ext)"
			}
			let url = directory.appendingPathComponent(name)
			if !fileExists(url.path) {
				return url
			}
			n += 1
		}
	}

	private static func fileExtension(from destination: String) -> String? {
		let filename = filename(from: destination)
		let ext = URL(fileURLWithPath: filename).pathExtension.lowercased()
		return ext.isEmpty ? nil : ext
	}
}

enum MarkdownBlock: Equatable {
	case heading(level: Int, content: String)
	case paragraph(String)
	case bullet(String)
	case orderedStep(number: Int, content: String)
	case blockquote(String)
	case horizontalRule
	case code(String)
	case table(MarkdownTable)
	case imageGroup([MarkdownImage])
	case fileLink(MarkdownFileLink)
}
