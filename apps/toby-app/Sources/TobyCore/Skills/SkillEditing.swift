import Foundation

/// Editing `SKILL.md` files (port of `skills/manage.ts`).
extension SkillService {
	func skillFile(_ dirName: String) throws -> URL {
		guard !dirName.isEmpty, dirName == (dirName as NSString).lastPathComponent, !dirName.hasPrefix(".") else { throw TodoError.invalid("Invalid skill.") }
		let url = root.appending(path: dirName).appending(path: "SKILL.md")
		guard FileManager.default.fileExists(atPath: url.path) else { throw TodoError("not_found", "Skill file not found: \(url.path)", status: 404) }
		return url
	}

	/// A new `new-skill[-n]` folder with a starter `SKILL.md`.
	public func create() throws -> String {
		try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
		var dirName = "new-skill"
		var index = 1
		while FileManager.default.fileExists(atPath: root.appending(path: dirName).path) {
			dirName = "new-skill-\(index)"
			index += 1
		}
		let dir = root.appending(path: dirName)
		try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
		try Data("---\nname: New Skill\ndescription: Describe what this skill does and when Toby should use it.\n---\n\n".utf8).write(to: dir.appending(path: "SKILL.md"))
		return dirName
	}

	public func delete(_ dirName: String) throws {
		try FileManager.default.removeItem(at: try skillFile(dirName).deletingLastPathComponent())
	}

	static func encode(_ value: String) -> String {
		let lines = value.replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n", omittingEmptySubsequences: false)
		guard let first = lines.first else { return "" }
		return ([String(first)] + lines.dropFirst().map { "  \($0)" }).joined(separator: "\n")
	}

	static func rawBody(_ raw: String) -> (frontmatter: String, body: String) {
		var text = raw
		if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
		if let match = text.firstMatch(of: /^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/) { return (String(match.1), String(match.2)) }
		return ("", text)
	}

	/// Update `name`, `summary` (stored as `description`), or `enabled`.
	public func updateField(_ dirName: String, field: String, value: String) throws {
		let url = try skillFile(dirName)
		let raw = try String(contentsOf: url, encoding: .utf8)
		guard var frontmatter = Self.parseFrontmatter(raw)?.frontmatter else { throw TodoError.invalid("Invalid SKILL.md frontmatter: \(url.path)") }
		switch field {
		case "name": frontmatter["name"] = value.trimmingCharacters(in: .whitespacesAndNewlines)
		case "summary", "description":
			frontmatter["description"] = value.trimmingCharacters(in: .whitespacesAndNewlines)
			frontmatter["summary"] = nil
		case "enabled":
			let normalized = value.trimmingCharacters(in: .whitespaces).lowercased()
			frontmatter["enabled"] = normalized == "true" || normalized == "yes" ? "true" : "false"
		case "icon": frontmatter["icon"] = value.trimmingCharacters(in: .whitespaces).isEmpty ? nil : value.trimmingCharacters(in: .whitespaces)
		default: throw TodoError.invalid("Unknown skill field: \(field)")
		}
		guard !(frontmatter["name"] ?? "").isEmpty else { throw TodoError.invalid("Skill name cannot be empty.") }
		guard !((frontmatter["summary"] ?? "").isEmpty && (frontmatter["description"] ?? "").isEmpty) else { throw TodoError.invalid("Skill summary cannot be empty.") }
		let reserved = ["name", "description", "summary", "enabled", "icon"]
		var lines = reserved.compactMap { key in frontmatter[key].map { "\(key): \(Self.encode($0))" } }
		lines += frontmatter.keys.filter { !reserved.contains($0) }.sorted().map { "\($0): \(Self.encode(frontmatter[$0]!))" }
		try Data("---\n\(lines.joined(separator: "\n"))\n---\n\(Self.rawBody(raw).body)".utf8).write(to: url, options: .atomic)
	}

	public func updateBody(_ dirName: String, markdown: String) throws {
		let url = try skillFile(dirName)
		let block = Self.rawBody(try String(contentsOf: url, encoding: .utf8)).frontmatter
		var body = markdown
		if body.hasPrefix("\u{FEFF}") { body.removeFirst() }
		let next = block.isEmpty ? "---\nname: \(dirName)\ndescription: \(dirName)\n---\n\(body)" : block + body
		try Data(next.utf8).write(to: url, options: .atomic)
	}
}
