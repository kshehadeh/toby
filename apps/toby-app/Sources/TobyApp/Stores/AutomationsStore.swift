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
  private var assessmentGeneration = 0
  var isAssessingFolder = false
  var folderAssessment: NativeFolderScan?
  var folderAssessmentKey: String?
  var folderAssessmentError: String?
  @ObservationIgnored private var folderScanTask: Task<NativeFolderScan, Error>?
  var canSaveEditor: Bool {
    (editor?.canSave ?? false) && !isAssessingFolder
      && (editor?.triggerType != "macos.fileChanges"
        || (folderAssessment != nil && folderAssessmentKey == editor?.folderWatch.assessmentKey
          && folderAssessmentError == nil
          && (!(folderAssessment?.limited ?? false) && (folderAssessment?.files.count ?? 0) < 10000
            || editor?.allowLargeFolder == true)))
  }
  private var generation = 0
  private let client: TobyClient
  init(client: TobyClient = TobyClient()) { self.client = client }
  var selected: AutomationItem? { items.first { $0.id == selectedId } }
  var isDirty: Bool { editor != baseline }
  func resetForHomeSwitch() {
    cancelFolderAssessment()
    folderAssessment = nil
    folderAssessmentKey = nil
    folderAssessmentError = nil
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
    folderAssessment = nil
    folderAssessmentKey = nil
    folderAssessmentError = nil
    editor = AutomationEditorDraft(item: item)
    baseline = editor
    editorError = nil
  }
  func cancelEditor() {
    cancelFolderAssessment()
    folderAssessment = nil
    folderAssessmentKey = nil
    editor = nil
    baseline = nil
    editorError = nil
  }
  func save() async {
    guard canSaveEditor, let draft = editor else { return }
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
  func cancelFolderAssessment() {
    assessmentGeneration += 1
    folderScanTask?.cancel()
    folderScanTask = nil
    isAssessingFolder = false
  }
  func assessFolder() async {
    cancelFolderAssessment()
    folderAssessment = nil
    folderAssessmentKey = nil
    folderAssessmentError = nil
    guard let draft = editor, draft.triggerType == "macos.fileChanges", !draft.folder.isEmpty else {
      return
    }
    let assessmentToken = assessmentGeneration
    let watch = draft.folderWatch
    let current = generation
    isAssessingFolder = true
    let task = Task.detached(priority: .utility) {
      try await NativeFolderScanService.shared.scan(watch, assessment: true)
    }
    folderScanTask = task
    do {
      let result = try await withTaskCancellationHandler {
        try await task.value
      } onCancel: {
        task.cancel()
      }
      guard !Task.isCancelled, current == generation, assessmentToken == assessmentGeneration,
        editor?.folderWatch.assessmentKey == watch.assessmentKey
      else { return }
      folderAssessment = result
      folderAssessmentKey = watch.assessmentKey
    } catch {
      if !Task.isCancelled, current == generation, assessmentToken == assessmentGeneration,
        editor?.folderWatch.assessmentKey == watch.assessmentKey
      {
        folderAssessmentError = error.localizedDescription
      }
    }
    if current == generation, assessmentToken == assessmentGeneration,
      editor?.folderWatch.assessmentKey == watch.assessmentKey
    {
      isAssessingFolder = false
      folderScanTask = nil
    }
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
