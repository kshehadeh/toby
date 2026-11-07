import SwiftUI

struct TodoDetailView: View {
	@Bindable var store: TodosStore
	let todo: TobyTodo
	@State private var showHistory = false

	private var isEditable: Bool { !todo.deleted && todo.state.status == "open" }

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 22) {
				DetailHeading(title: todo.title, accessibilityIdentifier: "todo-detail-title")
				actions
				metadata
				if !todo.description.isEmpty {
					DetailSection(title: "Description") {
						MarkdownText(text: todo.description, font: .body, foregroundStyle: AppTheme.primaryText).textSelection(.enabled)
					}
				}
				if isEditable || !todo.checklist.isEmpty {
					TodoChecklistSection(store: store, todo: todo, isEditable: isEditable)
				}
				if isEditable || !todo.reminders.isEmpty {
					TodoRemindersSection(store: store, todo: todo, isEditable: isEditable)
				}
				DisclosureGroup("History", isExpanded: $showHistory) {
					TodoHistoryList(store: store, todo: todo)
				}
				.accessibilityIdentifier("todo-history")
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth, alignment: .leading)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(AppTheme.contentPadding)
		}
		.background(SettingsDesign.canvasBackground)
		.task(id: todo.revision) { if showHistory { await store.loadHistory(todo) } }
		.onChange(of: showHistory) { _, shown in if shown { Task { await store.loadHistory(todo) } } }
		.accessibilityIdentifier("todo-detail")
	}

	private var actions: some View {
		HStack {
			if todo.deleted {
				Button("Restore", systemImage: "arrow.uturn.backward") { Task { await store.mutate("restore", todo: todo) } }
			} else if todo.state.status == "open" {
				Button("Complete", systemImage: "checkmark.circle") { Task { await store.complete(todo) } }
					.accessibilityIdentifier("todo-complete")
				if todo.recurrence != nil {
					Button("Skip occurrence") { Task { await store.mutate("skip", todo: todo) } }
				}
				Button("Edit", systemImage: "pencil") { store.startEditor(todo) }
				tagMenu
				Button("Delete", systemImage: "trash", role: .destructive) { store.pendingDelete = todo }
			} else {
				Button("Reopen", systemImage: "arrow.uturn.backward") { Task { await store.mutate("reopen", todo: todo) } }
			}
		}
		.disabled(store.isSaving)
	}

	private var tagMenu: some View {
		Menu("Tags", systemImage: "tag") {
			if store.tags.isEmpty {
				Text("No tags yet")
			}
			ForEach(store.tags) { tag in
				Toggle(tag.name, isOn: Binding(
					get: { todo.tags.contains(tag.id) },
					set: { enabled in Task { await store.setTag(tag.id, enabled: enabled, on: todo) } }
				))
			}
			Divider()
			Button("Manage lists and tags…") { store.isShowingOrganization = true }
		}
		.fixedSize()
		.accessibilityIdentifier("todo-tags-menu")
	}

	private var metadata: some View {
		DetailMetadataStack {
			DetailMetadataRow(label: "Status", value: todo.deleted ? "Recently deleted" : todo.state.status.capitalized)
			DetailMetadataRow(label: "Due", value: todo.dueLabel)
			DetailMetadataRow(label: "Priority", value: todo.priority.capitalized)
			DetailMetadataRow(label: "List", value: store.lists.first { $0.id == todo.listId }?.name ?? todo.listId)
			if let recurrence = todo.recurrence {
				DetailMetadataRow(label: "Repeat", value: recurrence.summary)
			}
			if let projectId = todo.projectId {
				DetailMetadataRow(label: "Project", value: store.projects.first { $0.id == projectId }?.name ?? todo.projectLabel ?? "\(projectId) (not on this Mac)")
			}
			if !todo.tags.isEmpty {
				DetailMetadataRow(label: "Tags", value: todo.tags.map { id in store.tags.first { $0.id == id }?.name ?? id }.joined(separator: ", "))
			}
		}
	}
}

extension TodoRecurrence {
	var summary: String {
		let span = interval == 1 ? unit : "\(interval) \(unit)s"
		var text = mode == "completion" ? "\(interval == 1 ? "1 \(unit)" : span) after completion" : "Every \(span)"
		if mode == "calendar", unit == "week", let weekdays, !weekdays.isEmpty {
			let symbols = Calendar(identifier: .gregorian).shortWeekdaySymbols
			text += " on " + weekdays.sorted().compactMap { symbols.indices.contains($0) ? symbols[$0] : nil }.joined(separator: ", ")
		}
		if let endDate { text += " until \(endDate)" }
		return text
	}
}
