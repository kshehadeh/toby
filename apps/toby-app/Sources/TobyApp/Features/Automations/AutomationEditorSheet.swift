import SwiftUI

struct AutomationEditorSheet: View {
  @Bindable var store: AutomationsStore
  var body: some View {
    EditorSheet(
      title: store.editor?.existingId == nil ? "New Automation" : "Edit Automation",
      isSaving: store.isSaving, canSave: store.canSaveEditor, isDirty: store.isDirty,
      errorMessage: store.editorError, size: .wide, accessibilityIdentifier: "automation-editor",
      onCancel: { store.cancelEditor() }, onSave: { Task { await store.save() } }
    ) {
      Form {
        Section("Trigger") {
          TextField("Name", text: field(\.name)).accessibilityIdentifier("automation-name")
          Picker("When", selection: field(\.triggerType)) {
            Text("Return after idle").tag("macos.userReturned")
            Text("Mac wakes").tag("macos.didWake")
            Text("Files in a folder").tag("macos.fileChanges")
          }
          if store.editor?.triggerType == "macos.userReturned" {
            Stepper(
              "Idle for at least \(store.editor?.idleMinutes ?? 30) minutes",
              value: field(\.idleMinutes), in: 1...10080)
          }
          if store.editor?.triggerType == "macos.fileChanges" {
            AutomationFolderSection(store: store)
          }
          Text(
            "Toby observes events while the app is running. Return timing is sampled every five seconds. No input content is recorded."
          ).font(.caption).foregroundStyle(.secondary)
        }
        Section("Conditions") {
          TextField("Timezone", text: field(\.timezone))
          HStack {
            ForEach(0..<7) { day in
              Toggle(
                Calendar.current.shortWeekdaySymbols[day],
                isOn: Binding(
                  get: { store.editor?.weekdays.contains(day) ?? false },
                  set: {
                    if $0 {
                      store.editor?.weekdays.insert(day)
                    } else {
                      store.editor?.weekdays.remove(day)
                    }
                  })
              ).toggleStyle(.button)
            }
          }
          Text("No selected days means every day.").font(.caption).foregroundStyle(.secondary)
          Toggle("Only within a time window", isOn: field(\.useTimeWindow))
          if store.editor?.useTimeWindow == true {
            TextField("Start (24-hour HH:mm)", text: field(\.startTime))
            TextField("End (24-hour HH:mm)", text: field(\.endTime))
          }
          Stepper(
            "Cooldown: \(store.editor?.cooldownMinutes ?? 5) minutes",
            value: field(\.cooldownMinutes), in: 0...10080)
          Toggle("At most once per day", isOn: field(\.oncePerDay))
        }
        Section("Flow") {
          Picker("Run", selection: field(\.flowId)) {
            Text("Select a flow").tag("")
            if let selected = store.editor?.flowId, !selected.isEmpty,
              !store.flows.contains(where: { $0.id == selected })
            {
              Text("Unavailable flow").tag(selected)
            }
            ForEach(store.flows) { flow in Text(flow.displayName).tag(flow.id) }
          }.accessibilityIdentifier("automation-flow-picker")
          if let flow = store.flows.first(where: { $0.id == store.editor?.flowId }) {
            Text(
              "\(flow.displayName): \(flow.nodes.count) steps. Destinations: \(flow.destinations?.map(\.type).joined(separator: ", ") ?? "none")."
            ).font(.caption)
          } else {
            Text("Create a custom flow first, then select it here.").font(.caption).foregroundStyle(
              .secondary)
          }
          Toggle("Notify when completed", isOn: field(\.notifyOnCompletion))
          DisclosureGroup("Flow input values") {
            Text(
              "Constants and event mappings supply flow context. Tools can use automation context references."
            ).font(.caption).foregroundStyle(.secondary)
            Text("Constants (JSON object)").font(.caption)
            TextEditor(text: field(\.inputsJSON)).font(.system(.body, design: .monospaced)).frame(
              height: 80)
            Text(
              "Event mappings: input name → id, type, occurredAt, payload.idleSeconds, payload.changes, or payload.folder"
            ).font(
              .caption)
            TextEditor(text: field(\.mappingsJSON)).font(.system(.body, design: .monospaced)).frame(
              height: 80)
          }
        }
        Section("Enable") {
          Toggle("Enabled", isOn: field(\.enabled)).accessibilityIdentifier("automation-enabled")
          Text(
            "Review the flow and delivery targets before enabling. A claimed run consumes cooldown and daily limits even if it fails. Interrupted runs are not retried automatically."
          ).font(.caption).foregroundStyle(.secondary)
        }
      }.formStyle(.grouped)
        .onChange(of: store.editor?.triggerType) { _, value in
          if value == "macos.fileChanges" { store.editor?.cooldownMinutes = 0 }
        }
    }
  }
  private func field<Value>(_ path: WritableKeyPath<AutomationEditorDraft, Value>) -> Binding<Value>
  {
    editorDraftFieldBinding($store.editor, path, fallback: AutomationEditorDraft())
  }
}
