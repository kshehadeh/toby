import Foundation
import Observation

@Observable @MainActor
final class AutomationsStore {
  var items: [AutomationItem] = []
  var flows: [FlowListItem] = []
  var runs: [AutomationRunItem] = []
  var selectedId: String?
  var sourceMessage = "Waiting for daemon"
  var isLoading = false
  var isSaving = false
  var error: String?
  var editorError: String?
  var editor: AutomationEditorDraft?
  var baseline: AutomationEditorDraft?
  var previewMessage: String?
  var selectedRun: AutomationRunItem?
  var pendingDelete: AutomationItem?
  private var generation = 0
  private let client: TobyClient
  init(client: TobyClient = TobyClient()) { self.client = client }
  var selected: AutomationItem? { items.first { $0.id == selectedId } }
  var isDirty: Bool { editor != baseline }
  func resetForHomeSwitch() {
    generation += 1
    items = []
    flows = []
    runs = []
    selectedId = nil
    editor = nil
    baseline = nil
    selectedRun = nil
    error = nil
    isLoading = false
    isSaving = false
    editorError = nil
    previewMessage = nil
    pendingDelete = nil
    sourceMessage = "Waiting for daemon"
  }
  func load() async {
    let current = generation
    isLoading = true
    defer { if current == generation { isLoading = false } }
    do {
      struct Items: Decodable { let automations: [AutomationItem] }
      struct Runs: Decodable { let runs: [AutomationRunItem] }
      let loaded: Items = try await client.automationRequest("")
      let state: AutomationSourceState = try await client.automationRequest("/status")
      let history: Runs = try await client.automationRequest("/runs")
      let available = try await client.listFlows()
      guard current == generation else { return }
      items = loaded.automations
      sourceMessage = state.message
      runs = history.runs
      flows = available.filter { !$0.builtin }
      error = nil
    } catch { if current == generation { self.error = error.localizedDescription } }
  }
  func startEditor(_ item: AutomationItem? = nil) {
    editor = AutomationEditorDraft(item: item)
    baseline = editor
    editorError = nil
  }
  func cancelEditor() {
    editor = nil
    baseline = nil
    editorError = nil
  }
  func save() async {
    guard let draft = editor else { return }
    let current = generation
    isSaving = true
    defer { if current == generation { isSaving = false } }
    do {
      struct Saved: Decodable { let automation: AutomationItem }
      let saved: Saved = try await client.automationRequest(
        draft.existingId.map { "/\($0)" } ?? "", method: draft.existingId == nil ? "POST" : "PATCH",
        body: draft.body())
      guard current == generation else { return }
      selectedId = saved.automation.id
      cancelEditor()
      await load()
    } catch { if current == generation { editorError = error.localizedDescription } }
  }
  func setEnabled(_ item: AutomationItem, enabled: Bool) async {
    let current = generation
    var draft = AutomationEditorDraft(item: item)
    draft.enabled = enabled
    do {
      struct Saved: Decodable { let automation: AutomationItem }
      let _: Saved = try await client.automationRequest(
        "/\(item.id)", method: "PATCH", body: draft.body())
      guard current == generation else { return }
      await load()
    } catch { if current == generation { self.error = error.localizedDescription } }
  }
  func delete(_ item: AutomationItem) async {
    let current = generation
    do {
      struct Result: Decodable { let ok: Bool }
      let _: Result = try await client.automationRequest("/\(item.id)", method: "DELETE")
      guard current == generation else { return }
      if selectedId == item.id { selectedId = nil }
      await load()
    } catch { if current == generation { self.error = error.localizedDescription } }
  }
  func preview(_ item: AutomationItem) async {
    let current = generation
    do {
      struct Preview: Decodable {
        let matches: Bool
        let reason: String?
      }
      let result: Preview = try await client.automationRequest(
        "/\(item.id)/test", method: "POST", body: [:])
      guard current == generation else { return }
      previewMessage =
        result.matches
        ? "This example event matches. No flow was run."
        : "Skipped: \(result.reason ?? "Unknown reason"). No flow was run."
    } catch { if current == generation { self.error = error.localizedDescription } }
  }
  func openRun(_ id: String) async {
    let current = generation
    do {
      struct Result: Decodable { let run: AutomationRunItem }
      let result: Result = try await client.automationRequest("/runs/\(id)")
      guard current == generation else { return }
      selectedId = result.run.automationId
      selectedRun = result.run
    } catch { if current == generation { self.error = error.localizedDescription } }
  }
}
