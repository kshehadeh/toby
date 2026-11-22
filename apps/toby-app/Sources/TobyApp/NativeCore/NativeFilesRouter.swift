import Foundation
import TobyAI
import TobyCore

/// In-process personas, skills, and projects (native mode). JSON matches the
/// daemon's `/api/personas`, `/api/skills`, `/api/projects`.
struct NativeFilesRouter: Sendable {
	let personas: PersonaService
	let skills: SkillService
	let projects: ProjectService

	func data(_ value: JSONValue) -> Data { Data(value.jsonString().utf8) }

	func personaList() -> Data { data(personas.listJSON()) }

	func personaDetail(_ name: String) throws -> Data {
		guard let detail = personas.detailJSON(name) else { throw TobyClientError.serverError("Persona not found") }
		return data(detail)
	}

	func skillList() -> Data { data(skills.listJSON()) }

	func skillDetail(_ dirName: String) throws -> Data {
		guard let detail = skills.detailJSON(dirName) else { throw TobyClientError.serverError("Skill not found") }
		return data(detail)
	}

	func projectList() throws -> Data {
		data(["projects": .array(try projects.list().map(\.json))])
	}

	func project(_ id: String) throws -> Data {
		guard let project = try projects.resolve(id) else { throw TobyClientError.serverError("Project not found") }
		return data(["project": project.json, "sessions": .array(try projects.sessions.list(projectID: project.id, limit: 100))])
	}

	func createProject(name: String) throws -> Data {
		data(["project": try projects.create(name: name.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmptyString ?? "New project").json])
	}

	func updateProject(_ id: String, name: String?, summary: String?, personaName: String?, folderPath: String?) throws -> Data {
		// nil = unchanged; "" = clear the project persona.
		let persona: String?? = personaName.map { $0.isEmpty ? nil : $0 }
		do {
			return data(["project": try projects.update(id, name: name, summary: summary, folderPath: folderPath, personaName: persona).json])
		} catch let error as TodoError {
			throw TobyClientError.serverError(error.message)
		}
	}

	func deleteProject(_ id: String) throws {
		guard try projects.resolve(id) != nil else { throw TobyClientError.serverError("Project not found") }
		try projects.delete(id)
	}

	func projectTree(_ id: String) throws -> Data {
		guard let project = try projects.resolve(id) else { throw TobyClientError.serverError("Project not found") }
		return data(["tree": .array(projects.tree(project))])
	}

	func createProjectSession(_ id: String) throws -> Data {
		guard let project = try projects.resolve(id) else { throw TobyClientError.serverError("Project not found") }
		return data(["session": try projects.sessions.create(name: nil, settings: ["projectId": .string(project.id)])])
	}
}

extension String {
	var nilIfEmptyString: String? { isEmpty ? nil : self }
}
