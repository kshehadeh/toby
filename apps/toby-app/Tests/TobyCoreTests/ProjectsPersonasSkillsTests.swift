import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

func temporaryHome() throws -> URL {
	let url = FileManager.default.temporaryDirectory.appending(path: "toby-home-\(UUID().uuidString)", directoryHint: .isDirectory)
	try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
	return url
}

@Suite("Projects")
struct ProjectServiceTests {
	@Test func createsFoldersAndUniqueSlugs() throws {
		let home = try temporaryHome()
		defer { try? FileManager.default.removeItem(at: home) }
		let service = ProjectService(writer: try TobyDatabase.inMemory().writer, tobyDirectory: home)
		let first = try service.create(name: "Q4 Launch!")
		let second = try service.create(name: "Q4 launch")
		#expect(first.slug == "q4-launch")
		#expect(second.slug == "q4-launch-2")
		let fm = FileManager.default
		#expect(fm.fileExists(atPath: first.folderPath + "/AGENTS.md"))
		#expect(fm.fileExists(atPath: first.folderPath + "/outputs"))
		#expect(fm.fileExists(atPath: first.folderPath + "/.agent/skills/project-organization/SKILL.md"))
		#expect(first.folderPath == home.appending(path: "projects/\(first.id)").standardizedFileURL.path)
		#expect(try service.list().map(\.name) == ["Q4 launch", "Q4 Launch!"])
		#expect(try service.resolve("q4-launch-2")?.id == second.id)
		#expect(ProjectService.nameFromPrompt("plan the  big offsite next quarter please now", fallbackIndex: 3) == "Plan The Big Offsite Next Quarter")
	}

	@Test func updateClearsPersonaAndDeleteUnlinksEverything() throws {
		let home = try temporaryHome()
		defer { try? FileManager.default.removeItem(at: home) }
		let database = try TobyDatabase.inMemory()
		let service = ProjectService(writer: database.writer, tobyDirectory: home)
		let project = try service.create(name: "Atlas", personaName: "Mailman")
		#expect(project.personaName == "Mailman")
		#expect(try service.update(project.id, summary: "Ship it").personaName == "Mailman")
		#expect(try service.update(project.id, personaName: .some(nil)).personaName == nil)

		let todos = TodoService(writer: database.writer, tobyDirectory: home)
		let todo = try todos.create(["title": "Draft spec", "projectId": .string(project.id), "projectLabel": "Atlas"])
		let session = try service.sessions.create(name: "Kickoff", settings: ["projectId": .string(project.id)])
		#expect(try service.sessions.list(projectID: project.id).count == 1)
		try Data(#"{"activeProject":"atlas","other":1}"#.utf8).write(to: home.appending(path: "config.json"))

		try service.delete(project.id)
		#expect(try service.resolve(project.id) == nil)
		#expect(try todos.get(todo["id"]!.stringValue!)["projectId"] == .null)
		#expect(try service.sessions.list().contains { $0["id"] == session["id"] })
		let config = try JSONValue(parsing: String(contentsOf: home.appending(path: "config.json"), encoding: .utf8))
		#expect(config["activeProject"] == nil)
		#expect(config["other"] == 1)
	}

	@Test func treeListsDirectoriesFirstAndSkipsHiddenAndSymlinks() throws {
		let home = try temporaryHome()
		defer { try? FileManager.default.removeItem(at: home) }
		let service = ProjectService(writer: try TobyDatabase.inMemory().writer, tobyDirectory: home)
		let project = try service.create(name: "Tree")
		let root = URL(fileURLWithPath: project.folderPath)
		try "x".write(to: root.appending(path: "b.txt"), atomically: true, encoding: .utf8)
		try "x".write(to: root.appending(path: ".hidden"), atomically: true, encoding: .utf8)
		try FileManager.default.createSymbolicLink(at: root.appending(path: "link"), withDestinationURL: home)
		let names = service.tree(project).compactMap { $0["name"]?.stringValue }
		#expect(names == [".agent", "outputs", "AGENTS.md", "b.txt"])
		let file = service.tree(project).first { $0["name"] == "b.txt" }
		#expect(file?["size"] == 1)
		#expect(file?["relativePath"] == "b.txt")
	}
}

@Suite("Personas")
struct PersonaServiceTests {
	@Test func builtInsShipInstructionsAndMapModelsToOpenRouter() throws {
		let home = try temporaryHome()
		defer { try? FileManager.default.removeItem(at: home) }
		let service = PersonaService(tobyDirectory: home)
		#expect(service.list().map(\.name) == ["Toby", "Mailman"])
		#expect(PersonaService.toby.instructions.hasPrefix("You are Toby"))
		#expect(!PersonaService.mailman.instructions.isEmpty)
		#expect(PersonaService.openRouterModel(provider: "openai", model: "gpt-5-mini") == "openai/gpt-5-mini")
		#expect(PersonaService.openRouterModel(provider: "vercel", model: "anthropic/claude-sonnet-5") == "anthropic/claude-sonnet-5")
		#expect(PersonaService.openRouterModel(provider: "ollama", model: "llama3.2") == ModelDefaults.chat)
		#expect(service.imageURL(for: "toby.png") != nil)
		#expect(service.imageURL(for: "default.png") != nil)
		#expect(service.imageURL(for: "../etc/passwd") == nil)
	}

	@Test func customPersonasAndDefaultsPersistInConfigAlongsideOtherKeys() throws {
		let home = try temporaryHome()
		defer { try? FileManager.default.removeItem(at: home) }
		try Data(#"{"web":{"port":7847},"personas":[{"name":"Toby","instructions":"ignored","promptMode":"replace","ai":{"provider":"openai","model":"gpt-5"}}]}"#.utf8)
			.write(to: home.appending(path: "config.json"))
		let service = PersonaService(tobyDirectory: home)
		let toby = try #require(service.resolve("Toby"))
		#expect(toby.instructions == PersonaService.toby.instructions)
		#expect(toby.promptMode == "add")
		#expect(toby.openRouterModel == "openai/gpt-5")
		// Mailman inherits Toby's stored model when it has none of its own.
		#expect(service.resolve("Mailman")?.model == "gpt-5")

		var coach = PersonaService.toby
		coach.name = "Coach"
		coach.instructions = "Be encouraging."
		coach.imagePath = nil
		try service.save(coach)
		try service.setDefault("Coach")
		#expect(service.defaultPersona().name == "Coach")
		#expect(service.list().map(\.name) == ["Toby", "Mailman", "Coach"])
		#expect(service.detailJSON("Coach")?["persona"]?["isDefault"] == true)
		try service.delete("Coach")
		#expect(service.defaultName == "Toby")
		#expect(throws: TodoError.self) { try service.delete("Toby") }
		let config = try JSONValue(parsing: String(contentsOf: home.appending(path: "config.json"), encoding: .utf8))
		#expect(config["web"]?["port"] == 7847)
	}
}

@Suite("Skills")
struct SkillServiceTests {
	@Test func parsesFrontmatterListsAndDisabledFlag() throws {
		let raw = """
		---
		name: Research helper
		description: Finds and summarizes sources.
		enabled: no
		tools:
		  - webFetch
		  - readPdf, webFetch
		icon: icon.png
		---

		# Steps
		Do the thing.
		"""
		let skill = try #require(SkillService.parse(dirName: "research", raw: raw))
		#expect(skill.name == "Research helper")
		#expect(skill.summary == "Finds and summarizes sources.")
		#expect(!skill.enabled)
		#expect(skill.tools == ["webFetch", "readPdf"])
		#expect(skill.iconPath == "icon.png")
		#expect(skill.bodyMarkdown == "# Steps\nDo the thing.")
		#expect(SkillService.parse(dirName: "x", raw: "no frontmatter") == nil)
		#expect(SkillService.parse(dirName: "x", raw: "---\nname: Only name\n---\nbody") == nil)
	}

	@Test func seedsTheBuiltinFlowBuilderOnceAndListsSkills() throws {
		let home = try temporaryHome()
		defer { try? FileManager.default.removeItem(at: home) }
		let service = SkillService(root: home.appending(path: "skills"))
		let skills = service.load()
		#expect(skills.map(\.dirName) == ["flow-builder"])
		try FileManager.default.removeItem(at: home.appending(path: "skills/flow-builder"))
		#expect(service.load().isEmpty)
		#expect(service.detailJSON("missing") == nil)
		#expect(SkillService.catalogSignature(skills).count == 16)
	}
}
