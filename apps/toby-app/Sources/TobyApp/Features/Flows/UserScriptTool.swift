import Foundation
import Observation

struct UserScriptTool: Decodable, Equatable, Identifiable {
	let id: String
	let name: String
	let description: String
	let language: String
	let inputNames: [String]
	let outputKind: String
	let currentRevision: Int
	let source: String
	let usedBy: [String]
}

struct UserScriptToolTest: Decodable {
	let ok: Bool
	let result: AnyCodable?
	let error: String?
}

struct ScriptInputDraft: Identifiable, Equatable {
	let id = UUID()
	var name: String
}

struct UserScriptToolDraft: Equatable {
	var id: String?
	var name = ""
	var description = ""
	var language = "typescript"
	var inputs: [ScriptInputDraft] = []
	var outputKind = "text"
	var source = "export default async function run(input: Record<string, unknown>) {\n  return \"Hello from Toby\";\n}"

	init() {}

	init(tool: UserScriptTool) {
		id = tool.id
		name = tool.name
		description = tool.description
		language = tool.language
		inputs = tool.inputNames.map { ScriptInputDraft(name: $0) }
		outputKind = tool.outputKind
		source = tool.source
	}

	var names: [String] {
		inputs.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines) }
	}

	var areInputNamesValid: Bool {
		names.allSatisfy { $0.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil }
			&& Set(names).count == names.count
	}

	var isValid: Bool {
		!name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
			&& isTestable
	}

	var isTestable: Bool {
		!source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && areInputNamesValid
	}

	var body: [String: Any] {
		["name": name, "description": description, "language": language,
		 "inputNames": names, "outputKind": outputKind, "source": source]
	}
}

@Observable
@MainActor
final class UserScriptToolsStore {
	var tools: [UserScriptTool] = []
	var draft: UserScriptToolDraft? {
		didSet {
			if draft != oldValue { testOutput = nil }
		}
	}
	var baseline: UserScriptToolDraft?
	var isLoading = false
	var isSaving = false
	var isTesting = false
	var error: String?
	var testValues: [String: String] = [:]
	var testOutput: String?
	var pendingDelete: UserScriptTool?
	var editorSessionId = UUID()

	private let client = TobyClient()

	var isDirty: Bool { draft != baseline }
	var testInputObject: [String: String] {
		var result: [String: String] = [:]
		for name in draft?.names ?? [] where !name.isEmpty {
			result[name] = testValues[name] ?? ""
		}
		return result
	}

	func load() async {
		isLoading = true
		defer { isLoading = false }
		do { tools = try await client.listUserScriptTools(); error = nil }
		catch { self.error = error.localizedDescription }
	}

	func create() {
		draft = .init()
		baseline = draft
		testValues = [:]
		testOutput = nil
		error = nil
		editorSessionId = UUID()
	}

	func edit(_ tool: UserScriptTool) {
		draft = .init(tool: tool)
		baseline = draft
		testValues = [:]
		testOutput = nil
		error = nil
		editorSessionId = UUID()
	}

	func cancel() {
		draft = nil
		baseline = nil
		testValues = [:]
		error = nil
		editorSessionId = UUID()
	}

	func save() async {
		guard let draft, draft.isValid else { return }
		isSaving = true
		defer { isSaving = false }
		do {
			let saved = try await client.saveUserScriptTool(id: draft.id, body: draft.body)
			if let index = tools.firstIndex(where: { $0.id == saved.id }) { tools[index] = saved }
			else { tools.append(saved) }
			tools.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
			self.draft = .init(tool: saved)
			baseline = self.draft
			error = nil
		} catch { self.error = error.localizedDescription }
	}

	func test() async {
		guard let draft, draft.isTestable else { return }
		isTesting = true
		defer { isTesting = false }
		do {
			let response = try await client.testUserScriptTool(draft: draft, input: testInputObject)
			if self.draft == draft {
				testOutput = response.ok ? (response.result?.displayString ?? "null") : (response.error ?? "Tool failed")
			}
		} catch {
			if self.draft == draft { testOutput = error.localizedDescription }
		}
	}

	func delete(_ tool: UserScriptTool) async {
		pendingDelete = nil
		do {
			try await client.deleteUserScriptTool(id: tool.id)
			tools.removeAll { $0.id == tool.id }
			if draft?.id == tool.id { cancel() }
			error = nil
		} catch { self.error = error.localizedDescription }
	}
}
