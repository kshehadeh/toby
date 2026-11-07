import SwiftUI

struct TodosView: View {
	@Bindable var store: TodosStore
	@State private var preferList = false
	@Environment(\.scenePhase) private var scenePhase

	var body: some View {
		FeatureWorkspaceSplit(listTitle: "Todos", isShowingList: preferList || store.selectedTodo == nil, onShowList: { preferList = true }) {
			browser
		} detail: {
			if let todo = store.selectedTodo {
				TodoDetailView(store: store, todo: todo)
			} else {
				FeatureBrowserPlaceholder(systemImage: "checklist", title: "No todo selected", prompt: "Select a todo", onCreate: { store.startEditor() }, createPhrase: "create a todo")
			}
		}
		.onChange(of: store.selectedOccurrenceId) { _, id in if id != nil { preferList = false } }
		.task {
			await store.loadOrganization()
			while !Task.isCancelled {
				await store.refresh()
				do { try await Task.sleep(for: .seconds(10)) } catch { break }
			}
		}
		.task(id: filterKey) { await store.refresh() }
		.onReceive(NotificationCenter.default.publisher(for: .todosDidChange)) { _ in Task { await store.refresh() } }
		.onChange(of: scenePhase) { _, phase in if phase == .active { Task { await store.refresh() } } }
		.sheet(item: editorSheetItem($store.editor, onDismiss: { store.cancelEditor() })) { _ in TodoEditorSheet(store: store) }
		.sheet(isPresented: $store.isShowingOrganization) { TodoOrganizationSheet(store: store) }
		.alert("Move todo to Recently deleted?", isPresented: Binding(get: { store.pendingDelete != nil }, set: { if !$0 { store.pendingDelete = nil } })) {
			Button("Cancel", role: .cancel) { store.pendingDelete = nil }
			Button("Delete", role: .destructive) {
				guard let todo = store.pendingDelete else { return }
				store.pendingDelete = nil
				Task { await store.mutate("delete", todo: todo) }
			}
		} message: { Text("The todo and its history remain recoverable and the deletion syncs to your other Macs.") }
		.alert("Complete with unfinished checklist items?", isPresented: Binding(get: { store.pendingComplete != nil }, set: { if !$0 { store.pendingComplete = nil } })) {
			Button("Cancel", role: .cancel) { store.pendingComplete = nil }
			Button("Complete") {
				guard let todo = store.pendingComplete else { return }
				store.pendingComplete = nil
				Task { await store.mutate("complete", todo: todo, extra: ["allowIncompleteChecklist": true]) }
			}
		} message: { Text("The unfinished items remain in this occurrence's history.") }
		.accessibilityIdentifier("todos-workspace")
		.tutorialTip(.todos)
	}

	private var filterKey: String { [store.filter.rawValue, store.query, store.listId, store.tagId, store.projectId].joined(separator: "|") }

	private var browser: some View {
		VStack(spacing: 8) {
			Picker("View", selection: $store.filter) {
				ForEach(TodoViewFilter.allCases) { filter in Text(filter.title).tag(filter) }
			}
			.pickerStyle(.menu)
			.padding(.horizontal, 10)
			TextField("Search todos", text: $store.query)
				.textFieldStyle(.roundedBorder)
				.padding(.horizontal, 10)
				.accessibilityIdentifier("todos-search")
			HStack {
				Menu("Filters", systemImage: "line.3.horizontal.decrease") {
					Picker("List", selection: $store.listId) {
						Text("All lists").tag("")
						ForEach(store.lists) { Text($0.name).tag($0.id) }
					}
					Picker("Tag", selection: $store.tagId) {
						Text("All tags").tag("")
						ForEach(store.tags) { Text($0.name).tag($0.id) }
					}
					Picker("Project", selection: $store.projectId) {
						Text("All projects").tag("")
						ForEach(store.projects) { Text($0.name).tag($0.id) }
					}
					Divider()
					Button("Manage lists and tags…") { store.isShowingOrganization = true }
				}
				.accessibilityIdentifier("todos-filters")
				Spacer()
				if store.isLoading { ProgressView().controlSize(.mini) }
				Button("New todo", systemImage: "plus") { store.startEditor() }.labelStyle(.iconOnly)
			}
			.padding(.horizontal, 10)
			if let error = store.errorMessage {
				InlineStatusMessage(message: error, tone: .error, font: .caption).padding(.horizontal, 10)
				Button("Retry") { Task { await store.refresh() } }
			}
			if store.syncStatus?.pausedForRestore == true {
				Text("Sync and reminders are paused. Review the restored todos before merging.")
					.font(.caption).foregroundStyle(AppTheme.secondaryText).padding(.horizontal, 10)
			}
			FeatureBrowserList(isLoading: store.isLoading, isEmpty: store.todos.isEmpty, loadingText: "Loading todos…", emptyText: "No todos here. Create one with +.", onClearSelection: { store.selectedOccurrenceId = nil }) {
				if store.filter == .today {
					todoGroup("Overdue", todos: store.todos.filter { ($0.due?.date ?? "") < store.today })
					todoGroup("Due today", todos: store.todos.filter { $0.due?.date == store.today })
				} else {
					ForEach(store.todos, id: \.occurrenceId) { row($0) }
				}
				if store.todos.count < store.total {
					Button("Load more") { Task { await store.refresh(append: true) } }.disabled(store.isLoading)
				}
			}
		}
		.padding(.top, 10)
	}
	@ViewBuilder private func todoGroup(_ title: String, todos: [TobyTodo]) -> some View {
		if !todos.isEmpty {
			Text(title).font(.caption.weight(.semibold)).foregroundStyle(AppTheme.secondaryText).padding(.horizontal, 10)
			ForEach(todos, id: \.occurrenceId) { row($0) }
		}
	}
	private func row(_ todo: TobyTodo) -> some View {
		Button { store.selectedOccurrenceId = todo.occurrenceId } label: {
			FeatureBrowserRow(title: todo.title, subtitle: todo.dueLabel, badge: todo.priority == "none" ? nil : todo.priority.capitalized,
				isSelected: store.selectedOccurrenceId == todo.occurrenceId, accessibilityIdentifier: "todo-row-\(todo.occurrenceId)") {
				FeatureBrowserRowGlyph(systemImage: "checklist", isSelected: store.selectedOccurrenceId == todo.occurrenceId)
			}
		}
		.buttonStyle(.plain)
	}
}
