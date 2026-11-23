import Foundation
import TobyAI

/// A chat persona: instructions, prompt mode, model, portrait.
public struct Persona: Sendable, Hashable {
	public var name: String
	public var instructions: String
	/// `add` (append to Toby's base prompt) or `replace`.
	public var promptMode: String
	/// Legacy provider id kept for display/import; runtime is always OpenRouter.
	public var provider: String
	public var model: String
	public var imagePath: String?

	/// The OpenRouter model slug for this persona.
	public var openRouterModel: String { PersonaService.openRouterModel(provider: provider, model: model) }

	init?(json: JSONValue) {
		guard let name = json["name"]?.stringValue, !name.isEmpty else { return nil }
		self.name = name
		instructions = json["instructions"]?.stringValue ?? ""
		promptMode = json["promptMode"]?.stringValue ?? "add"
		provider = json["ai"]?["provider"]?.stringValue ?? "openrouter"
		model = json["ai"]?["model"]?.stringValue ?? ModelDefaults.chat
		imagePath = json["imagePath"]?.stringValue
	}

	init(name: String, instructions: String, promptMode: String = "add", provider: String, model: String, imagePath: String?) {
		self.name = name
		self.instructions = instructions
		self.promptMode = promptMode
		self.provider = provider
		self.model = model
		self.imagePath = imagePath
	}

	var configJSON: JSONValue {
		var object: [String: JSONValue] = [
			"name": .string(name), "instructions": .string(instructions), "promptMode": .string(promptMode),
			"ai": ["provider": .string(provider), "model": .string(model)],
		]
		if let imagePath { object["imagePath"] = .string(imagePath) }
		return .object(object)
	}
}

/// Personas (port of `personas/*`). Built-ins ship with the app; users may
/// change their model. Custom personas and the default live in `config.json`
/// (`personas`, `defaultPersona`) alongside the other settings.
public final class PersonaService: Sendable {
	let tobyDirectory: URL

	public init(tobyDirectory: URL) {
		self.tobyDirectory = tobyDirectory
	}

	static func resource(_ name: String) -> String {
		guard let url = Bundle.tobyCoreResources.url(forResource: name, withExtension: "md", subdirectory: "Resources/personas"),
		      let text = try? String(contentsOf: url, encoding: .utf8) else { return "" }
		return text
	}

	public static let toby = Persona(name: "Toby", instructions: resource("toby-instructions"), provider: "openrouter", model: ModelDefaults.chat, imagePath: "toby.png")
	public static let mailman = Persona(name: "Mailman", instructions: resource("mailman-instructions"), provider: "openrouter", model: ModelDefaults.chat, imagePath: "mailman.png")
	public static let builtIns = [toby, mailman]

	public static func isBuiltIn(_ name: String) -> Bool { builtIns.contains { $0.name == name } }

	/// Map a legacy `{provider, model}` to an OpenRouter slug.
	public static func openRouterModel(provider: String, model: String) -> String {
		let trimmed = model.trimmingCharacters(in: .whitespacesAndNewlines)
		switch provider {
		case "openrouter", "vercel": return trimmed.contains("/") ? trimmed : (trimmed.isEmpty ? ModelDefaults.chat : "openai/\(trimmed)")
		case "openai": return trimmed.isEmpty ? ModelDefaults.chat : "openai/\(trimmed)"
		default: return ModelDefaults.chat
		}
	}

	// MARK: Config file

	var configURL: URL { tobyDirectory.appending(path: "config.json") }

	func readConfig() -> [String: JSONValue] {
		guard let data = try? Data(contentsOf: configURL), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return [:] }
		return value.objectValue ?? [:]
	}

	func writeConfig(_ object: [String: JSONValue]) throws {
		try FileManager.default.createDirectory(at: tobyDirectory, withIntermediateDirectories: true)
		let pretty = JSONEncoder.tobyPretty
		try pretty.encode(JSONValue.object(object)).write(to: configURL, options: .atomic)
	}

	var configPersonas: [Persona] {
		(readConfig()["personas"]?.arrayValue ?? []).compactMap(Persona.init(json:))
	}

	// MARK: Resolution

	/// Built-ins keep shipped instructions; persisted entries only change model/image.
	func withBuiltInDefaults(_ persona: Persona) -> Persona {
		guard let builtIn = Self.builtIns.first(where: { $0.name == persona.name }) else { return persona }
		var merged = persona
		merged.instructions = builtIn.instructions
		merged.promptMode = builtIn.promptMode
		merged.imagePath = persona.imagePath?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? builtIn.imagePath
		return merged
	}

	func builtInResolved(_ builtIn: Persona, stored: [Persona]) -> Persona {
		if let persisted = stored.first(where: { $0.name == builtIn.name }) { return withBuiltInDefaults(persisted) }
		if builtIn.name == Self.toby.name { return builtIn }
		guard let toby = stored.first(where: { $0.name == Self.toby.name }) else { return builtIn }
		var copy = builtIn
		copy.provider = toby.provider
		copy.model = toby.model
		return copy
	}

	public func list() -> [Persona] {
		let stored = configPersonas
		return Self.builtIns.map { builtInResolved($0, stored: stored) } + stored.filter { !Self.isBuiltIn($0.name) }
	}

	public func resolve(_ name: String) -> Persona? {
		let stored = configPersonas
		if let found = stored.first(where: { $0.name == name }) { return withBuiltInDefaults(found) }
		guard let builtIn = Self.builtIns.first(where: { $0.name == name }) else { return nil }
		return builtInResolved(builtIn, stored: stored)
	}

	public var defaultName: String {
		readConfig()["defaultPersona"]?.stringValue ?? Self.toby.name
	}

	public func defaultPersona() -> Persona {
		resolve(defaultName) ?? Self.toby
	}

	// MARK: Mutations

	public func save(_ persona: Persona) throws {
		var config = readConfig()
		var stored = (config["personas"]?.arrayValue ?? []).filter { $0["name"]?.stringValue != persona.name }
		stored.append(persona.configJSON)
		config["personas"] = .array(stored)
		try writeConfig(config)
	}

	public func delete(_ name: String) throws {
		guard !Self.isBuiltIn(name) else { throw TodoError("protected", "Built-in personas can't be deleted.") }
		var config = readConfig()
		config["personas"] = .array((config["personas"]?.arrayValue ?? []).filter { $0["name"]?.stringValue != name })
		if config["defaultPersona"]?.stringValue == name { config.removeValue(forKey: "defaultPersona") }
		try writeConfig(config)
	}

	public func setDefault(_ name: String) throws {
		guard resolve(name) != nil else { throw TodoError("not_found", "Persona not found", status: 404) }
		var config = readConfig()
		config["defaultPersona"] = .string(name)
		try writeConfig(config)
	}

	// MARK: Images

	/// A persona portrait: user upload in `persona/images/`, else bundled.
	public func imageURL(for filename: String?) -> URL? {
		let name = (filename?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? "default.png")
		guard name == (name as NSString).lastPathComponent else { return nil }
		let user = tobyDirectory.appending(path: "persona/images/\(name)")
		if FileManager.default.fileExists(atPath: user.path) { return user }
		let bundled = name == "default.png" ? "toby.png" : name
		return Bundle.tobyCoreResources.url(forResource: (bundled as NSString).deletingPathExtension, withExtension: (bundled as NSString).pathExtension, subdirectory: "Resources/personas")
	}

	// MARK: API payloads

	public func listJSON() -> JSONValue {
		let defaultName = defaultName
		return ["personas": .array(list().map { persona in
			var object: [String: JSONValue] = [
				"name": .string(persona.name), "label": .string(persona.name),
				"isDefault": .bool(persona.name == defaultName), "isBuiltIn": .bool(Self.isBuiltIn(persona.name)),
				"imageUrl": .string("/api/personas/image/\(persona.imagePath ?? "default.png")"),
			]
			if let image = persona.imagePath { object["imagePath"] = .string(image) }
			return .object(object)
		})]
	}

	public func detailJSON(_ name: String) -> JSONValue? {
		guard let persona = list().first(where: { $0.name == name }) else { return nil }
		var object: [String: JSONValue] = [
			"name": .string(persona.name), "label": .string(persona.name), "instructions": .string(persona.instructions),
			"promptMode": .string(persona.promptMode), "provider": "openrouter", "model": .string(persona.openRouterModel),
			"imageUrl": .string("/api/personas/image/\(persona.imagePath ?? "default.png")"),
			"isBuiltIn": .bool(Self.isBuiltIn(persona.name)), "isDefault": .bool(persona.name == defaultName),
		]
		if let image = persona.imagePath { object["imagePath"] = .string(image) }
		return ["persona": .object(object)]
	}
}

extension JSONEncoder {
	/// Pretty, sorted output for human-edited files like `config.json`.
	public static var tobyPretty: JSONEncoder {
		let encoder = JSONEncoder()
		encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
		return encoder
	}
}
