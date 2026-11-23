import Foundation
import TobyAI
import TobyCore

/// Settings actions for personas and skills, in process.
@MainActor
enum NativeConfigureActions {
	static func run(_ action: String, body: [String: String]) throws -> JSONValue {
		let root = NativeRuntime.shared.paths.root
		let personas = PersonaService(tobyDirectory: root)
		let skills = SkillService(root: NativeRuntime.shared.paths.skills)
		func value(_ key: String) -> String? { body[key] }
		func required(_ key: String) throws -> String {
			guard let text = body[key]?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { throw TobyClientError.serverError("\(key) required") }
			return text
		}
		var result: [String: JSONValue] = ["ok": true]
		switch action {
		case "create-persona":
			result["personaName"] = .string(try personas.create(name: value("name"), instructions: value("instructions"), promptMode: value("promptMode"), model: value("model")))
		case "update-persona":
			result["personaName"] = .string(try personas.update(try required("originalName"), name: value("name"), instructions: value("instructions"), promptMode: value("promptMode"), model: value("model")))
		case "delete-persona":
			try personas.delete(try required("personaName"))
		case "set-default-persona":
			try personas.setDefault(try required("personaName"))
		case "upload-persona-image":
			guard let data = Data(base64Encoded: try required("imageBase64")) else { throw TobyClientError.serverError("Image data is not valid.") }
			result["imagePath"] = .string(try personas.setImage(try required("personaName"), data: data, filename: value("filename")))
		case "reset-persona-image":
			try personas.resetImage(try required("personaName"))
		case "create-skill":
			result["dirName"] = .string(try skills.create())
		case "delete-skill":
			try skills.delete(try required("dirName"))
		case "update-skill-field":
			try skills.updateField(try required("dirName"), field: try required("field"), value: value("value") ?? "")
		case "update-skill-body":
			try skills.updateBody(try required("dirName"), markdown: value("body") ?? "")
		default:
			throw TobyClientError.serverError("Unknown action: \(action)")
		}
		if action.hasSuffix("persona") || action.contains("persona-") { NotificationCenter.default.post(name: .personasDidChange, object: nil) }
		return .object(result)
	}
}
