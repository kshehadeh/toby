import CryptoKit
import Foundation
import TobyAI

/// A `SKILL.md` skill (port of `skills/index.ts`).
public struct LocalSkill: Sendable, Hashable {
	public var dirName: String
	public var name: String
	public var summary: String
	public var enabled: Bool
	public var iconPath: String?
	public var createdAt: String?
	public var updatedAt: String?
	public var bodyMarkdown: String
	public var tools: [String]
	public var integrations: [String]
}

/// Local skills in `<tobyDir>/skills/<dir>/SKILL.md` (and project-local ones).
public struct SkillService: Sendable {
	public let root: URL

	public init(root: URL) {
		self.root = root
	}

	// MARK: Parsing

	/// Split `---` frontmatter (simple `key: value` with indented
	/// continuation lines) from the markdown body.
	public static func parseFrontmatter(_ raw: String) -> (frontmatter: [String: String], body: String)? {
		var text = raw
		if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
		let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
		guard normalized.hasPrefix("---\n") else { return nil }
		let afterOpen = normalized.dropFirst(4)
		guard let close = afterOpen.range(of: "\n---\n") else { return nil }
		let fmRaw = String(afterOpen[..<close.lowerBound])
		let body = String(afterOpen[close.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
		var frontmatter: [String: String] = [:]
		var currentKey: String?
		var buffer: [String] = []
		func flush() {
			if let currentKey { frontmatter[currentKey] = buffer.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines) }
			currentKey = nil
			buffer = []
		}
		for line in fmRaw.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
			if !line.hasPrefix(" "), !line.hasPrefix("\t"), let match = line.wholeMatch(of: /(\w+)\s*:\s*(.*)/) {
				flush()
				currentKey = String(match.1)
				buffer = [String(match.2).replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)]
				continue
			}
			if currentKey != nil, line.first?.isWhitespace == true || line.trimmingCharacters(in: .whitespaces).isEmpty {
				buffer.append(line.replacingOccurrences(of: "^\\s+", with: "", options: .regularExpression).replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression))
			}
		}
		flush()
		return (frontmatter, body)
	}

	static func listField(_ raw: String?) -> [String] {
		guard let raw else { return [] }
		var seen = Set<String>()
		var out: [String] = []
		for part in raw.split(whereSeparator: { $0 == "\n" || $0 == "," }) {
			let item = String(part).replacingOccurrences(of: "^\\s*[-*]\\s*", with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
			guard !item.isEmpty, seen.insert(item.lowercased()).inserted else { continue }
			out.append(item)
		}
		return out
	}

	public static func parse(dirName: String, raw: String) -> LocalSkill? {
		guard let parsed = parseFrontmatter(raw),
		      let name = parsed.frontmatter["name"]?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
		      let summary = parsed.frontmatter["summary"]?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
		      ?? parsed.frontmatter["description"]?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
		else { return nil }
		let enabledRaw = parsed.frontmatter["enabled"]?.trimmingCharacters(in: .whitespaces).lowercased()
		return LocalSkill(
			dirName: dirName,
			name: name,
			summary: summary,
			enabled: enabledRaw.map { !["false", "no", "0"].contains($0) } ?? true,
			iconPath: parsed.frontmatter["icon"]?.trimmingCharacters(in: .whitespaces).nilIfEmpty,
			bodyMarkdown: parsed.body,
			tools: listField(parsed.frontmatter["tools"]),
			integrations: listField(parsed.frontmatter["integrations"]),
		)
	}

	// MARK: Loading

	/// Seed the built-in `flow-builder` skill once (respects later edits/deletion).
	public func ensureBuiltins() {
		let fm = FileManager.default
		let marker = root.appending(path: ".builtin-seeds/flow-builder")
		guard !fm.fileExists(atPath: marker.path),
		      let source = Bundle.tobyCoreResources.url(forResource: "SKILL", withExtension: "md", subdirectory: "Resources/skills/flow-builder"),
		      let contents = try? Data(contentsOf: source) else { return }
		let skillFile = root.appending(path: "flow-builder/SKILL.md")
		try? fm.createDirectory(at: skillFile.deletingLastPathComponent(), withIntermediateDirectories: true)
		if !fm.fileExists(atPath: skillFile.path) { fm.createFile(atPath: skillFile.path, contents: contents) }
		try? fm.createDirectory(at: marker.deletingLastPathComponent(), withIntermediateDirectories: true)
		try? Data("1\n".utf8).write(to: marker)
	}

	public func load(seedBuiltins: Bool = true) -> [LocalSkill] {
		if seedBuiltins { ensureBuiltins() }
		let fm = FileManager.default
		guard let entries = try? fm.contentsOfDirectory(atPath: root.path) else { return [] }
		var skills: [LocalSkill] = []
		for dirName in entries where !dirName.hasPrefix(".") {
			var isDirectory: ObjCBool = false
			let file = root.appending(path: "\(dirName)/SKILL.md")
			guard fm.fileExists(atPath: root.appending(path: dirName).path, isDirectory: &isDirectory), isDirectory.boolValue,
			      let raw = try? String(contentsOf: file, encoding: .utf8),
			      var skill = Self.parse(dirName: dirName, raw: raw) else { continue }
			if let attributes = try? fm.attributesOfItem(atPath: file.path) {
				skill.createdAt = (attributes[.creationDate] as? Date).map(TodoRecurrence.isoString)
				skill.updatedAt = (attributes[.modificationDate] as? Date).map(TodoRecurrence.isoString)
			}
			skills.append(skill)
		}
		return skills.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
	}

	/// The resolved icon file for a skill, if its frontmatter names one inside its folder.
	public func iconURL(dirName: String) -> URL? {
		guard let skill = load(seedBuiltins: false).first(where: { $0.dirName == dirName }), let icon = skill.iconPath else { return nil }
		let folder = root.appending(path: dirName).standardizedFileURL
		let url = folder.appending(path: icon).standardizedFileURL
		guard url.path.hasPrefix(folder.path + "/"), FileManager.default.fileExists(atPath: url.path) else { return nil }
		return url
	}

	// MARK: Prompt helpers

	public static func catalogForPrompt(_ skills: [LocalSkill]) -> String {
		guard !skills.isEmpty else { return "(none)" }
		return skills.map { "- \($0.name): \(MemoryText.collapseWhitespace($0.summary))" }.joined(separator: "\n")
	}

	/// Short hash of names + summaries (routing-index invalidation).
	public static func catalogSignature(_ skills: [LocalSkill]) -> String {
		let rows: JSONValue = .array(skills.map { ["name": .string($0.name), "summary": .string(MemoryText.collapseWhitespace($0.summary))] })
		return String(SHA256.hash(data: Data(rows.jsonString().utf8)).map { String(format: "%02x", $0) }.joined().prefix(16))
	}

	// MARK: API payloads

	public func listJSON() -> JSONValue {
		["skills": .array(load().map { skill in summaryJSON(skill) })]
	}

	public func detailJSON(_ dirName: String) -> JSONValue? {
		guard let skill = load().first(where: { $0.dirName == dirName }) else { return nil }
		var object = summaryJSON(skill).objectValue ?? [:]
		object["bodyMarkdown"] = .string(skill.bodyMarkdown)
		object["tools"] = .array(skill.tools.map(JSONValue.string))
		object["integrations"] = .array(skill.integrations.map(JSONValue.string))
		return ["skill": .object(object)]
	}

	func summaryJSON(_ skill: LocalSkill) -> JSONValue {
		var object: [String: JSONValue] = [
			"dirName": .string(skill.dirName), "name": .string(skill.name), "description": .string(skill.summary),
			"summary": .string(skill.summary), "enabled": .bool(skill.enabled),
		]
		if iconURL(dirName: skill.dirName) != nil { object["iconUrl"] = .string("/api/skills/\(skill.dirName)/icon") }
		if let createdAt = skill.createdAt { object["createdAt"] = .string(createdAt) }
		if let updatedAt = skill.updatedAt { object["updatedAt"] = .string(updatedAt) }
		return .object(object)
	}
}
