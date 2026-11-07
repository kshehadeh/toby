import SwiftUI

/// Lists and tags change immediately, like other management rows; removal never deletes todos.
struct TodoOrganizationSheet: View {
	@Bindable var store: TodosStore
	@Environment(\.dismiss) private var dismiss
	@State private var newList = ""
	@State private var newTag = ""
	@State private var renaming: Target?
	@State private var renameText = ""
	@State private var pendingRemoval: Target?

	struct Target: Equatable {
		let kind: TodoOrganizationKind
		let item: TodoOrganizationItem
	}

	var body: some View {
		NavigationStack {
			Form {
				Section("Lists") {
					LabeledContent("Inbox") { Text("Default").foregroundStyle(AppTheme.secondaryText) }
					ForEach(store.lists.filter { $0.id != TodoOrganizationItem.inboxId }) { row(.list, $0) }
					addRow(placeholder: "New list", text: $newList, kind: .list)
				}
				Section("Tags") {
					if store.tags.isEmpty {
						Text("No tags yet.").foregroundStyle(AppTheme.secondaryText)
					}
					ForEach(store.tags) { row(.tag, $0) }
					addRow(placeholder: "New tag", text: $newTag, kind: .tag)
				}
				if let error = store.errorMessage {
					InlineStatusMessage(message: error, tone: .error, font: .caption)
				}
			}
			.formStyle(.grouped)
			.navigationTitle("Lists and tags")
			.toolbar {
				ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
			}
		}
		.frame(minWidth: 420, minHeight: 440)
		.alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
			TextField("Name", text: $renameText)
			Button("Cancel", role: .cancel) { renaming = nil }
			Button("Rename") {
				guard let target = renaming else { return }
				renaming = nil
				let name = renameText
				Task { await store.saveOrganization(target.kind, id: target.item.id, name: name) }
			}
			.disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
		}
		.alert(
			pendingRemoval?.kind == .list ? "Delete this list?" : "Delete this tag?",
			isPresented: Binding(get: { pendingRemoval != nil }, set: { if !$0 { pendingRemoval = nil } })
		) {
			Button("Cancel", role: .cancel) { pendingRemoval = nil }
			Button("Delete", role: .destructive) {
				guard let target = pendingRemoval else { return }
				pendingRemoval = nil
				Task { await store.saveOrganization(target.kind, id: target.item.id, remove: true) }
			}
		} message: {
			Text(pendingRemoval?.kind == .list
				? "Its todos move to Inbox. The change syncs to your other Macs."
				: "Todos keep everything except this tag. The change syncs to your other Macs.")
		}
		.accessibilityIdentifier("todo-organization")
	}

	private func row(_ kind: TodoOrganizationKind, _ item: TodoOrganizationItem) -> some View {
		HStack {
			Text(item.name)
			Spacer()
			Button("Rename…") { renameText = item.name; renaming = Target(kind: kind, item: item) }
			Button("Delete \(item.name)", systemImage: "trash", role: .destructive) { pendingRemoval = Target(kind: kind, item: item) }
				.labelStyle(.iconOnly)
				.buttonStyle(.borderless)
				.help("Delete")
		}
		.disabled(store.isSaving)
	}

	private func addRow(placeholder: String, text: Binding<String>, kind: TodoOrganizationKind) -> some View {
		HStack {
			TextField(placeholder, text: text)
				.onSubmit { add(text, kind: kind) }
				.accessibilityIdentifier("todo-organization-new-\(kind.rawValue)")
			Button("Add") { add(text, kind: kind) }
				.disabled(text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
		}
	}

	private func add(_ text: Binding<String>, kind: TodoOrganizationKind) {
		let name = text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !name.isEmpty else { return }
		text.wrappedValue = ""
		Task { await store.saveOrganization(kind, name: name) }
	}
}
