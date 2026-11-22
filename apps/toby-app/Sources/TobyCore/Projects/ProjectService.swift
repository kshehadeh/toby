import Foundation
import GRDB
import TobyAI

/// Projects: a canvas folder with AGENTS.md, project-local skills, and linked
/// chats/todos (port of `packages/core/src/projects/index.ts`).
public final class ProjectService: Sendable {
	static let defaultAgentsMarkdown = """
	# Project Instructions

	You are working in this project folder. Keep files organized according to the
	project-organization skill (create or update it as the layout evolves).

	When answering questions, search and read files in this folder first and prefer
	that content over general knowledge.

	Add any additional guidance for this project below.

	"""

	public static let organizationSkillName = "project-organization"
	static let organizationSkillMarkdown = """
	---
	name: project-organization
	description: How this project's folder is laid out. Apply on every project chat to keep files organized and to find existing work before answering.
	tools: listProjectFiles, searchProjectFiles, readProjectFile, writeTextFile, createProjectFolder, renameProjectFile, deleteProjectFile, deleteProjectFolder, createLocalSkill
	---

	# Project organization

	This skill is the source of truth for this project's folder layout. Follow it on every chat in this project.

	## How to maintain this skill

	1. Call `listProjectFiles` to inspect the current tree.
	2. Infer a layout from the project summary. If the summary is empty, use a small generic layout.
	3. Create missing folders with `createProjectFolder`. Write new text files with `writeTextFile`. Move misplaced files with `renameProjectFile`.
	4. Document the actual folder map under **Folder map** below. Update this skill (`createLocalSkill` with `preferredFolderName=project-organization` and `updateExisting=true`) whenever the map changes.
	5. Never delete or overwrite files or folders unless the user explicitly asks.

	## Default folders

	- `attachments/` — original files the user asked to save into the project
	- `outputs/` — finished generated artifacts
	- `.agent/skills/` — project-local skills (including this one)
	- `AGENTS.md` — durable project instructions (do not move)

	Add more folders when the work needs them (for example `research/`, `drafts/`, `references/`).

	## Folder map

	(Fill this in as the project takes shape.)

	## Ground answers in project files

	Before answering questions about this project's work, search and read files in the project folder (`searchProjectFiles`, `readProjectFile`, `readPdf`). Prefer that content over general knowledge, web search, or integrations unless the user is clearly asking about something outside the project.

	"""

	static let maxTreeDepth = 8
	static let maxTreeEntries = 500

	let writer: any DatabaseWriter
	let tobyDirectory: URL
	let todos: TodoService
	public let sessions: ChatSessionStore

	public init(writer: any DatabaseWriter, tobyDirectory: URL) {
		self.writer = writer
		self.tobyDirectory = tobyDirectory
		todos = TodoService(writer: writer, tobyDirectory: tobyDirectory)
		sessions = ChatSessionStore(writer: writer)
	}

	public struct Project: Sendable, Hashable {
		public var id: String
		public var slug: String
		public var name: String
		public var summary: String
		public var personaName: String?
		public var folderPath: String
		public var createdAt: String
		public var updatedAt: String

		public var outputsDir: String { folderPath + "/outputs" }
		public var skillsDir: String { folderPath + "/.agent/skills" }
		public var legacySkillsDir: String { folderPath + "/skills" }

		/// Payload shape of `/api/projects`.
		public var json: JSONValue {
			[
				"id": .string(id), "slug": .string(slug), "name": .string(name), "summary": .string(summary),
				"folderPath": .string(folderPath), "personaName": personaName.map(JSONValue.string) ?? .null,
				"outputsDir": .string(outputsDir), "skillsDir": .string(skillsDir),
				"createdAt": .string(createdAt), "updatedAt": .string(updatedAt),
			]
		}
	}

	static func project(_ row: Row) -> Project {
		Project(
			id: row["id"],
			slug: row["slug"],
			name: row["name"],
			summary: row["summary"] ?? "",
			personaName: row["persona_name"],
			folderPath: TodoSyncSettings.resolve(row["folder_path"]),
			createdAt: row["created_at"],
			updatedAt: row["updated_at"],
		)
	}

	// MARK: Helpers

	public static func slugify(_ input: String) -> String {
		var out = ""
		var pendingDash = false
		for scalar in input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().unicodeScalars {
			if ("a" ... "z").contains(scalar) || ("0" ... "9").contains(scalar) {
				if pendingDash, !out.isEmpty { out.append("-") }
				pendingDash = false
				out.unicodeScalars.append(scalar)
			} else {
				pendingDash = true
			}
		}
		return String(out.prefix(64))
	}

	public static func nameFromPrompt(_ prompt: String, fallbackIndex: Int) -> String {
		let words = prompt.split(whereSeparator: \.isWhitespace).prefix(6)
		guard !words.isEmpty else { return "Project \(fallbackIndex)" }
		return String(words.map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ").prefix(80))
	}

	func ensureFolders(_ folderPath: String) throws {
		let fm = FileManager.default
		let root = URL(fileURLWithPath: folderPath)
		try fm.createDirectory(at: root.appending(path: "outputs"), withIntermediateDirectories: true)
		let skills = root.appending(path: ".agent/skills")
		try fm.createDirectory(at: skills, withIntermediateDirectories: true)
		let agents = root.appending(path: "AGENTS.md")
		if !fm.fileExists(atPath: agents.path) {
			try Self.defaultAgentsMarkdown.write(to: agents, atomically: true, encoding: .utf8)
		}
		let skillFile = skills.appending(path: "\(Self.organizationSkillName)/SKILL.md")
		if !fm.fileExists(atPath: skillFile.path) {
			try fm.createDirectory(at: skillFile.deletingLastPathComponent(), withIntermediateDirectories: true)
			try Self.organizationSkillMarkdown.write(to: skillFile, atomically: true, encoding: .utf8)
		}
	}

	// MARK: CRUD

	static let select = "SELECT id, slug, name, summary, folder_path, persona_name, created_at, updated_at FROM projects"

	public func list() throws -> [Project] {
		try writer.read { db in try Row.fetchAll(db, sql: "\(Self.select) ORDER BY name COLLATE NOCASE ASC").map(Self.project) }
	}

	public func resolve(_ idOrSlug: String) throws -> Project? {
		let key = idOrSlug.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !key.isEmpty else { return nil }
		return try writer.read { db in
			try Row.fetchOne(db, sql: "\(Self.select) WHERE id = ? OR slug = ? LIMIT 1", arguments: [key, key]).map(Self.project)
		}
	}

	public func create(name: String? = nil, prompt: String? = nil, summary: String? = nil, folderPath: String? = nil, personaName: String? = nil) throws -> Project {
		let id = UUID().uuidString.lowercased()
		let ts = TodoRecurrence.isoString(Date())
		let folder = TodoSyncSettings.resolve(folderPath?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? tobyDirectory.appending(path: "projects/\(id)").path)
		try ensureFolders(folder)
		try writer.write { db in
			let count = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM projects") ?? 0
			let resolvedName = name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? Self.nameFromPrompt(prompt ?? "", fallbackIndex: count + 1)
			let base = Self.slugify(resolvedName).nilIfEmpty ?? "project-\(count + 1)"
			var slug = base
			var suffix = 2
			while try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM projects WHERE slug = ?)", arguments: [slug]) == true {
				slug = "\(base)-\(suffix)"
				suffix += 1
			}
			try db.execute(sql: """
			INSERT INTO projects (id, slug, name, summary, folder_path, persona_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			""", arguments: [id, slug, resolvedName, summary?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "", folder,
			                 personaName?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty, ts, ts])
		}
		return try resolve(id)!
	}

	/// Update fields; `personaName: .some(nil)` clears the project persona.
	public func update(_ idOrSlug: String, name: String? = nil, summary: String? = nil, folderPath: String? = nil, personaName: String?? = nil) throws -> Project {
		guard let project = try resolve(idOrSlug) else { throw TodoError("not_found", "Project not found: \(idOrSlug)", status: 404) }
		var folder = project.folderPath
		if let path = folderPath?.trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty {
			folder = TodoSyncSettings.resolve(path)
			try ensureFolders(folder)
		}
		let persona: String? = if let personaName { personaName?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty } else { project.personaName }
		try writer.write { db in
			try db.execute(sql: """
			UPDATE projects SET name = ?, summary = ?, folder_path = ?, persona_name = ?, updated_at = ? WHERE id = ?
			""", arguments: [name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? project.name, summary ?? project.summary, folder, persona,
			                 TodoRecurrence.isoString(Date()), project.id])
		}
		return try resolve(project.id)!
	}

	/// Delete a project: unlink its todos and chats, clear it as active.
	public func delete(_ idOrSlug: String) throws {
		guard let project = try resolve(idOrSlug) else { return }
		try todos.unlinkProject(project.id)
		try writer.write { db in
			try db.execute(sql: "UPDATE chat_sessions SET project_id = NULL WHERE project_id = ?", arguments: [project.id])
			try db.execute(sql: "DELETE FROM projects WHERE id = ?", arguments: [project.id])
		}
		let config = tobyDirectory.appending(path: "config.json")
		if let data = try? Data(contentsOf: config), case var .object(object) = try JSONDecoder().decode(JSONValue.self, from: data),
		   object["activeProject"]?.stringValue == project.slug
		{
			object.removeValue(forKey: "activeProject")
			try Data(JSONValue.object(object).jsonString().utf8).write(to: config, options: .atomic)
		}
	}

	// MARK: Files

	/// File tree (directories first, hidden entries except `.agent` skipped,
	/// symlinks ignored, at most 500 entries / depth 8).
	public func tree(_ project: Project) -> [JSONValue] {
		var count = 0
		let fm = FileManager.default
		let root = URL(fileURLWithPath: project.folderPath)
		func walk(_ directory: URL, depth: Int) -> [JSONValue] {
			guard depth <= Self.maxTreeDepth, count < Self.maxTreeEntries,
			      let names = try? fm.contentsOfDirectory(atPath: directory.path) else { return [] }
			let entries = names
				.filter { !$0.hasPrefix(".") || $0 == ".agent" }
				.compactMap { name -> (name: String, url: URL, isDirectory: Bool, attributes: [FileAttributeKey: Any])? in
					let url = directory.appending(path: name)
					guard let attributes = try? fm.attributesOfItem(atPath: url.path),
					      let type = attributes[.type] as? FileAttributeType, type != .typeSymbolicLink else { return nil }
					return (name, url, type == .typeDirectory, attributes)
				}
				.sorted { $0.isDirectory != $1.isDirectory ? $0.isDirectory : $0.name.localizedCompare($1.name) == .orderedAscending }
			var out: [JSONValue] = []
			for entry in entries {
				guard count < Self.maxTreeEntries else { break }
				count += 1
				let relative = String(entry.url.path.dropFirst(root.path.count + 1))
				let modified = (entry.attributes[.modificationDate] as? Date).map { JSONValue.number(($0.timeIntervalSince1970 * 1000).rounded()) }
				var object: [String: JSONValue] = ["name": .string(entry.name), "relativePath": .string(relative), "kind": .string(entry.isDirectory ? "directory" : "file")]
				if let modified { object["modifiedAtMs"] = modified }
				if entry.isDirectory {
					object["children"] = .array(walk(entry.url, depth: depth + 1))
				} else if (entry.attributes[.type] as? FileAttributeType) == .typeRegular {
					if let size = entry.attributes[.size] as? NSNumber { object["size"] = .number(size.doubleValue) }
				} else {
					count -= 1
					continue
				}
				out.append(.object(object))
			}
			return out
		}
		return walk(root, depth: 0)
	}

	/// `AGENTS.md` (≤ 96 KB, text only) for the project system prompt.
	public func contextDocuments(_ project: Project) -> [(path: String, content: String)] {
		let url = URL(fileURLWithPath: project.folderPath).appending(path: "AGENTS.md")
		guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
		      (attributes[.size] as? NSNumber)?.intValue ?? .max <= 96 * 1024,
		      let content = try? String(contentsOf: url, encoding: .utf8), !content.contains("\u{0}")
		else { return [] }
		return [("AGENTS.md", content)]
	}
}
