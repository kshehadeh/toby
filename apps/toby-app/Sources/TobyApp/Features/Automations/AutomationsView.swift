import SwiftUI

struct AutomationsView: View {
  @Bindable var store: AutomationsStore
  var onOpenFlow: (String) -> Void
  @State private var preferList = false
  var body: some View {
    FeatureWorkspaceSplit(
      listTitle: "Automations", isShowingList: preferList || store.selected == nil,
      onShowList: { preferList = true }
    ) {
      FeatureBrowserList(
        isLoading: store.isLoading, isEmpty: store.items.isEmpty,
        loadingText: "Loading automations…", emptyText: "No automations",
        onClearSelection: { store.selectedId = nil }
      ) {
        ForEach(store.items) { item in
          Button {
            store.selectedId = item.id
            store.previewMessage = nil
            preferList = false
          } label: {
            FeatureBrowserRow(
              title: item.name, subtitle: item.triggerLabel,
              isSelected: store.selectedId == item.id,
              accessibilityLabel: "\(item.name), \(item.enabled ? "enabled" : "disabled")",
              accessibilityIdentifier: "automation-row-\(item.id)"
            ) {
              FeatureBrowserRowGlyph(systemImage: "bolt", isSelected: store.selectedId == item.id)
            } trailing: {
              Text(item.enabled ? "On" : "Off").font(.caption).foregroundStyle(
                AppTheme.secondaryText)
            }
          }.buttonStyle(.plain)
        }
      }
    } detail: {
      if let item = store.selected {
        AutomationDetailView(store: store, item: item, onOpenFlow: onOpenFlow)
      } else if let error = store.error {
        ContentUnavailableView {
          Label("Automations unavailable", systemImage: "exclamationmark.triangle")
        } description: {
          Text(error)
        } actions: {
          Button("Retry") { Task { await store.load() } }
        }
      } else {
        FeatureBrowserPlaceholder(
          systemImage: "bolt", title: "No automation selected", prompt: "Select an automation",
          onCreate: { store.startEditor() }, createPhrase: "create an automation")
      }
    }
    .task {
      while !Task.isCancelled {
        await store.load()
        try? await Task.sleep(for: .seconds(5))
      }
    }
    .sheet(item: $store.editor) { _ in AutomationEditorSheet(store: store) }
    .sheet(item: $store.selectedRun) { run in AutomationRunSheet(run: run) }
    .alert(
      "Delete Automation?",
      isPresented: Binding(
        get: { store.pendingDelete != nil }, set: { if !$0 { store.pendingDelete = nil } })
    ) {
      Button("Delete", role: .destructive) {
        if let item = store.pendingDelete {
          store.pendingDelete = nil
          Task { await store.delete(item) }
        }
      }
      Button("Cancel", role: .cancel) { store.pendingDelete = nil }
    } message: {
      Text("Future events will stop running this automation. Saved run history is retained.")
    }
    .accessibilityIdentifier("automations-workspace")
  }
}

private struct AutomationDetailView: View {
  @Bindable var store: AutomationsStore
  let item: AutomationItem
  var onOpenFlow: (String) -> Void
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text(item.name).font(.title2.bold())
        Text(item.triggerLabel).foregroundStyle(AppTheme.secondaryText)
        if item.trigger.type == "macos.fileChanges" {
          DetailMetadataRow(
            label: "Changes", value: item.trigger.kinds?.joined(separator: ", ") ?? "new")
          DetailMetadataRow(
            label: "File types",
            value: item.trigger.extensions?.joined(separator: ", ").isEmpty == false
              ? (item.trigger.extensions ?? []).joined(separator: ", ") : "All")
          DetailMetadataRow(
            label: "Subfolders", value: item.trigger.recursive == true ? "Included" : "Excluded")
        }
        DetailMetadataRow(label: "Status", value: item.enabled ? store.sourceMessage : "Disabled")
        DetailMetadataRow(label: "Timezone", value: item.conditions.timezone)
        DetailMetadataRow(
          label: "Limits",
          value:
            "\(item.policy.cooldownSeconds / 60) minute cooldown\(item.policy.oncePerDay ? ", once per day" : "")"
        )
        if let window = item.conditions.timeWindow {
          DetailMetadataRow(label: "Time window", value: "\(window.start)–\(window.end)")
        }
        if let days = item.conditions.weekdays {
          DetailMetadataRow(
            label: "Days",
            value: days.sorted().map { Calendar.current.shortWeekdaySymbols[$0] }.joined(
              separator: ", "))
        }
        Button("Open flow") { onOpenFlow(item.action.flowId) }
        Text(
          "Native triggers require Toby.app to remain running. Idle means no input; wake does not imply that someone is present."
        ).font(.callout).foregroundStyle(AppTheme.secondaryText)
        if let error = store.error { InlineStatusMessage(message: error, tone: .error) }
        if let message = store.previewMessage {
          Text(message).font(.callout).accessibilityIdentifier("automation-preview-result")
        }
        Text("Recent runs").font(.headline)
        let runs = store.runs.filter { $0.automationId == item.id }
        if runs.isEmpty { Text("No events recorded yet").foregroundStyle(AppTheme.secondaryText) }
        ForEach(runs) { run in
          Button {
            store.selectedRun = run
          } label: {
            VStack(alignment: .leading, spacing: 4) {
              Text("\(run.createdAt) · \(run.status.capitalized)")
              if let reason = run.reason {
                Text(reason.replacingOccurrences(of: "_", with: " ")).font(.caption)
                  .foregroundStyle(AppTheme.secondaryText)
              }
            }.frame(maxWidth: .infinity, alignment: .leading)
          }.buttonStyle(.plain)
          Divider()
        }
      }.frame(maxWidth: SettingsDesign.contentMaxWidth, alignment: .leading).padding(
        AppTheme.contentPadding)
    }
  }
}

struct AutomationRunSheet: View {
  let run: AutomationRunItem
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text(run.definition.name).font(.title2.bold())
          DetailMetadataRow(label: "Status", value: run.status.capitalized)
          DetailMetadataRow(
            label: "Event",
            value: run.event.type == "macos.fileChanges"
              ? "Folder changes" : run.event.type == "macos.didWake" ? "Mac woke" : "User returned")
          DetailMetadataRow(label: "Occurred", value: run.event.occurredAt)
          if run.event.type == "macos.fileChanges" {
            Text(run.event.payload.prettyPrinted(maxLength: 100000)).font(
              .system(.caption, design: .monospaced)
            ).textSelection(.enabled)
          }
          if let reason = run.reason {
            Text(reason.replacingOccurrences(of: "_", with: " ")).textSelection(.enabled)
          }
          if let output = run.output {
            MarkdownText(text: output, font: .body, foregroundStyle: AppTheme.primaryText)
          }
          if let flowRunId = run.flowRunId { AutomationFlowRunLink(flowRunId: flowRunId) }
        }.padding(24).frame(maxWidth: SettingsDesign.contentMaxWidth, alignment: .leading)
      }.navigationTitle("Automation result")
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
    }.frame(minWidth: 560, minHeight: 420)
  }
}
private struct AutomationFlowRunLink: View {
  let flowRunId: String
  @State private var detail: FlowRunDetail?
  @State private var error: String?
  @State private var show = false
  var body: some View {
    Button("View flow steps") {
      show = true
      Task {
        do { detail = try await TobyClient().fetchFlowRun(id: flowRunId) } catch {
          self.error = error.localizedDescription
        }
      }
    }
    .sheet(isPresented: $show) {
      FlowRunDetailView(run: detail, isLoading: detail == nil && error == nil, error: error)
    }
  }
}

struct AutomationToolbar: ToolbarContent {
  @Bindable var store: AutomationsStore
  var body: some ToolbarContent {
    ToolbarItem(placement: .confirmationAction) {
      ControlGroup {
        Button("New Automation", systemImage: "plus") { store.startEditor() }
        if let item = store.selected {
          Button("Edit", systemImage: "pencil") { store.startEditor(item) }
          Button(item.enabled ? "Disable" : "Enable", systemImage: item.enabled ? "pause" : "play")
          {
            Task { await store.setEnabled(item, enabled: !item.enabled) }
          }
          Button("Preview rule", systemImage: "checkmark.circle") {
            Task { await store.preview(item) }
          }
          Button("Delete", systemImage: "trash", role: .destructive) { store.pendingDelete = item }
        }
      }
    }
  }
}
