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

struct UserScriptToolGeneration: Decodable {
	let source: String
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
			if draft != oldValue {
				testOutput = nil
				generationError = nil
			}
		}
	}
	var baseline: UserScriptToolDraft?
	var isLoading = false
	var isSaving = false
	var isTesting = false
	var isGeneratingCode = false
	var generationRequests: [String] = []
	var generationError: String?
	var error: String?
	var testValues: [String: String] = [:]
	var testOutput: String?
	var pendingDelete: UserScriptTool?
	var editorSessionId = UUID()

	private let client = TobyClient()
	private var activeGeneration: UUID?

	var isDirty: Bool { draft != baseline }
	var generationContext: [String] {
		var remaining = 12_000
		var context: [String] = []
		for request in generationRequests.suffix(8).reversed() {
			guard request.utf16.count <= remaining else { break }
			context.insert(request, at: 0)
			remaining -= request.utf16.count
		}
		return context
	}
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
		generationError = nil
		generationRequests = []
		activeGeneration = nil
		isGeneratingCode = false
		editorSessionId = UUID()
	}

	func edit(_ tool: UserScriptTool) {
		draft = .init(tool: tool)
		baseline = draft
		testValues = [:]
		testOutput = nil
		error = nil
		generationError = nil
		generationRequests = []
		activeGeneration = nil
		isGeneratingCode = false
		editorSessionId = UUID()
	}

	func cancel() {
		draft = nil
		baseline = nil
		testValues = [:]
		error = nil
		generationError = nil
		generationRequests = []
		activeGeneration = nil
		isGeneratingCode = false
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

	func generateCode(instruction: String) async {
		guard let draft, !isGeneratingCode else { return }
		let request = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !request.isEmpty else { return }
		let session = editorSessionId
		let generation = UUID()
		activeGeneration = generation
		isGeneratingCode = true
		generationError = nil
		defer {
			if activeGeneration == generation {
				activeGeneration = nil
				isGeneratingCode = false
			}
		}
		do {
			let response = try await client.generateUserScriptToolCode(
				draft: draft, instruction: request, previousRequests: generationContext
			)
			if !applyGeneratedSource(response.source, instruction: request, to: draft, in: session),
				self.draft?.id == draft.id, editorSessionId == session, generationError == nil {
				generationError = "The code changed while the request was running. Ask again to apply it to the latest code."
			}
		} catch {
			if self.draft == draft, editorSessionId == session {
				generationError = error.localizedDescription
			}
		}
	}

	@discardableResult
	func applyGeneratedSource(_ source: String, instruction: String, to original: UserScriptToolDraft, in session: UUID) -> Bool {
		guard draft == original, editorSessionId == session else { return false }
		guard !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
			generationError = "AI returned no code. Try describing the task more specifically."
			return false
		}
		draft?.source = source
		generationRequests.append(instruction)
		editorSessionId = UUID()
		return true
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
