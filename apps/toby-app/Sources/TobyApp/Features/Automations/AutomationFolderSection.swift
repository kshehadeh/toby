import AppKit
import SwiftUI

struct AutomationFolderSection: View {
  @Bindable var store: AutomationsStore
  private var signature: String {
    guard let d = store.editor else { return "" }
    return "\(d.folder)|\(d.recursive)|\(d.extensions)|\(d.excludedPaths)"
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(store.editor?.folder.isEmpty == false ? store.editor?.folder ?? "" : "Choose a folder")
          .lineLimit(2).textSelection(.enabled)
        Spacer()
        Button("Choose folder…", action: chooseFolder).accessibilityIdentifier(
          "automation-choose-folder")
      }
      Toggle("Include subfolders", isOn: field(\.recursive))
      HStack {
        ForEach(["new", "changed", "deleted"], id: \.self) { kind in
          Toggle(
            kind.capitalized,
            isOn: Binding(
              get: { store.editor?.changeKinds.contains(kind) ?? false },
              set: {
                if $0 {
                  store.editor?.changeKinds.insert(kind)
                } else {
                  store.editor?.changeKinds.remove(kind)
                }
              })
          ).toggleStyle(.button)
        }
      }
      TextField("File extensions (comma-separated; blank means all)", text: field(\.extensions))
      Stepper(
        "Wait for \(store.editor?.settlingSeconds ?? 5) seconds of quiet",
        value: field(\.settlingSeconds), in: 2...60)
      DisclosureGroup("Excluded paths") {
        Text(
          "One folder or file per line, relative to the watched folder or absolute. Exclude flow output folders to prevent repeated runs."
        ).font(.caption).foregroundStyle(.secondary)
        TextEditor(text: field(\.excludedPaths)).font(.system(.body, design: .monospaced)).frame(
          height: 70)
      }
      if store.isAssessingFolder {
        HStack {
          ProgressView().controlSize(.small)
          Text("Counting matching files…")
          Button("Cancel") { store.cancelFolderAssessment() }
        }
      } else if let error = store.folderAssessmentError {
        InlineStatusMessage(message: error, tone: .error)
        Button("Check folder again") { Task { await store.assessFolder() } }
      } else if let result = store.folderAssessment {
        Text(
          "\(result.limited ? "At least " : "")\(result.files.count.formatted()) matching files; \(result.visited.formatted()) entries inspected."
        ).font(.caption)
        if result.limited || result.files.count >= 10_000 {
          Label(
            "This folder contains many files or is slow to scan",
            systemImage: "exclamationmark.triangle"
          ).foregroundStyle(.secondary)
          Text(
            "Watching this folder may increase startup time and resource use. Choose a smaller folder, exclude subfolders, or narrow the file types. Scans over 100,000 entries or ten seconds pause observation."
          ).font(.caption)
          Toggle("Use folder anyway", isOn: field(\.allowLargeFolder)).accessibilityIdentifier(
            "automation-large-folder-ack")
        }
      } else if store.editor?.folder.isEmpty == false {
        Button("Check folder") { Task { await store.assessFolder() } }
      }
      Text(
        "Existing files form a baseline. Settled changes arrive in batches. Hidden files, package contents, and symbolic links are excluded. Deleted files provide metadata, not contents."
      ).font(.caption).foregroundStyle(.secondary)
      if (store.editor?.cooldownMinutes ?? 0) > 0 || store.editor?.oncePerDay == true {
        Text(
          "Cooldown and daily limits can skip file batches. Use zero cooldown to process each batch."
        ).font(.caption).foregroundStyle(.secondary)
      }
    }
    .onChange(of: signature) { _, _ in store.editor?.allowLargeFolder = false }
    .task(id: signature) {
      await store.assessFolder()
    }
  }
  private func chooseFolder() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.begin { response in
      if response == .OK, let url = panel.url {
        store.editor?.folder = url.standardizedFileURL.path
      }
    }
  }
  private func field<Value>(_ path: WritableKeyPath<AutomationEditorDraft, Value>) -> Binding<Value>
  {
    editorDraftFieldBinding($store.editor, path, fallback: AutomationEditorDraft())
  }
}
