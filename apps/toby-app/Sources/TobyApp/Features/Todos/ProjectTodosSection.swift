import SwiftUI

struct ProjectTodosSection: View {
	let project: ProjectSummary
	@State private var store = TodosStore()
	@Environment(\.scenePhase) private var scenePhase

	var body: some View {
		DetailSection(title: "Todos") {
			if let error = store.errorMessage {
				InlineStatusMessage(message: error, tone: .error, font: .caption)
				Button("Retry") { Task { await store.refresh() } }
			}
			if store.isLoading && store.todos.isEmpty {
				ProgressView("Loading todos…").controlSize(.small)
			} else if store.todos.isEmpty {
				Text("No open todos linked to this project.")
					.foregroundStyle(AppTheme.secondaryText)
			}
			ForEach(store.todos, id: \.occurrenceId) { todo in
				Button {
					NotificationCenter.default.post(name: .openTodo, object: todo.occurrenceId)
				} label: {
					HStack {
						Image(systemName: "circle").accessibilityHidden(true)
						Text(todo.title)
						Spacer()
						Text(todo.dueLabel).font(.caption).foregroundStyle(AppTheme.secondaryText)
					}
				}
				.buttonStyle(.plain)
				.accessibilityIdentifier("project-todo-\(todo.id)")
			}
			if store.todos.count < store.total {
				Button("Load more") { Task { await store.refresh(append: true) } }
					.disabled(store.isLoading)
			}
			Button("New todo", systemImage: "plus") {
				store.startEditor(projectId: project.id, projectLabel: project.name)
			}
			.accessibilityIdentifier("project-new-todo")
		}
		.task(id: project.id) {
			store.resetForHomeSwitch()
			store.filter = .allOpen
			store.projectId = project.id
			await store.loadOrganization()
			while !Task.isCancelled {
				await store.refresh()
				do { try await Task.sleep(for: .seconds(10)) } catch { break }
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .todosDidChange)) { _ in
			Task { await store.refresh() }
		}
		.onChange(of: scenePhase) { _, phase in
			if phase == .active { Task { await store.refresh() } }
		}
		.sheet(item: editorSheetItem($store.editor, onDismiss: { store.cancelEditor() })) { _ in
			TodoEditorSheet(store: store)
		}
	}
}
