import Foundation
import TobyAI

/// Persona edits from Settings (port of the configure `*-persona` actions).
extension PersonaService {
	var imagesDirectory: URL { tobyDirectory.appending(path: "persona/images") }

	func stored() -> [Persona] { configPersonas }

	/// Create a custom persona; returns its name.
	public func create(name requested: String?, instructions: String?, promptMode: String?, model: String?) throws -> String {
		let existing = stored()
		let name = requested?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? "Persona \(existing.count + 1)"
		guard !Self.isBuiltIn(name) else { throw TodoError.invalid("\"\(name)\" is a reserved persona name") }
		guard !existing.contains(where: { $0.name == name }) else { throw TodoError.invalid("Persona \"\(name)\" already exists") }
		try save(Persona(name: name, instructions: instructions ?? Self.toby.instructions, promptMode: promptMode == "replace" ? "replace" : "add",
		                 provider: "openrouter", model: model?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? ModelDefaults.chat, imagePath: nil))
		return name
	}

	/// Update a persona. Built-ins accept only a model change.
	public func update(_ original: String, name: String?, instructions: String?, promptMode: String?, model: String?) throws -> String {
		if Self.isBuiltIn(original) {
			guard name == nil, instructions == nil, promptMode == nil else { throw TodoError.invalid("Built-in personas only support model changes") }
			guard var persona = resolve(original) else { throw TodoError("not_found", "Persona \"\(original)\" not found", status: 404) }
			if let model = model?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty { persona.model = model; persona.provider = "openrouter" }
			try save(persona)
			return persona.name
		}
		var config = readConfig()
		var list = config["personas"]?.arrayValue ?? []
		guard let index = list.firstIndex(where: { $0["name"]?.stringValue == original }), var persona = Persona(json: list[index]) else {
			throw TodoError("not_found", "Persona \"\(original)\" not found", status: 404)
		}
		if let newName = name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty, newName != original {
			guard !Self.isBuiltIn(newName) else { throw TodoError.invalid("\"\(newName)\" is a reserved persona name") }
			guard !list.contains(where: { $0["name"]?.stringValue == newName }) else { throw TodoError.invalid("Persona \"\(newName)\" already exists") }
			persona.name = newName
			if config["defaultPersona"]?.stringValue == original { config["defaultPersona"] = .string(newName) }
		}
		if let instructions { persona.instructions = instructions }
		if let promptMode { persona.promptMode = promptMode.trimmingCharacters(in: .whitespaces) == "replace" ? "replace" : "add" }
		if let model = model?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty { persona.model = model; persona.provider = "openrouter" }
		list[index] = persona.configJSON
		config["personas"] = .array(list)
		try writeConfig(config)
		return persona.name
	}

	/// Store an uploaded portrait and point the persona at it.
	public func setImage(_ name: String, data: Data, filename: String?) throws -> String {
		var config = readConfig()
		var list = config["personas"]?.arrayValue ?? []
		guard let index = list.firstIndex(where: { $0["name"]?.stringValue == name }), var persona = Persona(json: list[index]) else {
			throw TodoError("not_found", "Persona \"\(name)\" not found", status: 404)
		}
		try FileManager.default.createDirectory(at: imagesDirectory, withIntermediateDirectories: true)
		let ext = filename.map { ($0 as NSString).pathExtension.lowercased() }?.nilIfEmpty ?? "png"
		let safe = name.replacing(/[^a-zA-Z0-9_-]/, with: "_")
		let file = "\(safe)-\(Int(Date().timeIntervalSince1970 * 1000)).\(ext)"
		try data.write(to: imagesDirectory.appending(path: file))
		if let old = persona.imagePath { removeImage(old) }
		persona.imagePath = file
		list[index] = persona.configJSON
		config["personas"] = .array(list)
		try writeConfig(config)
		return file
	}

	public func resetImage(_ name: String) throws {
		var config = readConfig()
		var list = config["personas"]?.arrayValue ?? []
		guard let index = list.firstIndex(where: { $0["name"]?.stringValue == name }), var persona = Persona(json: list[index]) else {
			throw TodoError("not_found", "Persona \"\(name)\" not found", status: 404)
		}
		guard let old = persona.imagePath else { return }
		removeImage(old)
		persona.imagePath = nil
		list[index] = persona.configJSON
		config["personas"] = .array(list)
		try writeConfig(config)
	}

	func removeImage(_ filename: String) {
		guard filename == (filename as NSString).lastPathComponent else { return }
		try? FileManager.default.removeItem(at: imagesDirectory.appending(path: filename))
	}
}
