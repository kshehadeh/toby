import SwiftUI

struct TodoEditorSheet: View {
	@Bindable var store: TodosStore
	private var draft: Binding<TodoEditorDraft> { editorDraftBinding($store.editor, fallback: TodoEditorDraft()) }
	var body: some View {
		EditorSheet(title: store.editor?.todoId == nil ? "New todo" : "Edit todo", isSaving: store.isSaving,
			canSave: store.editor?.canSave == true, isDirty: store.isDirty, errorMessage: store.editorError, size: .regular,
			accessibilityIdentifier: "todo-editor", onCancel: { store.cancelEditor() }, onSave: { Task { await store.saveEditor() } }) {
			TodoEditorForm(draft: draft, lists: store.lists, projects: store.projects)
		}
	}
}

private struct TodoEditorForm: View {
	@Binding var draft: TodoEditorDraft
	let lists: [TodoOrganizationItem]
	let projects: [ProjectSummary]

	var body: some View {
		Form {
			Section("Todo") {
				TextField("Title", text: $draft.title).accessibilityIdentifier("todo-editor-title")
				TextField("Description", text: $draft.description, axis: .vertical).lineLimit(3...8)
				Picker("Priority", selection: $draft.priority) {
					ForEach(["none", "low", "medium", "high"], id: \.self) { Text($0.capitalized).tag($0) }
				}
				Picker("List", selection: $draft.listId) {
					ForEach(lists) { Text($0.name).tag($0.id) }
				}
				Picker("Project", selection: $draft.projectId) {
					Text("No project").tag("")
					ForEach(projects) { Text($0.name).tag($0.id) }
					if !draft.projectId.isEmpty, !projects.contains(where: { $0.id == draft.projectId }) {
						Text(draft.projectLabel ?? draft.projectId).tag(draft.projectId)
					}
				}
				.onChange(of: draft.projectId) { _, id in draft.projectLabel = projects.first { $0.id == id }?.name }
				if draft.todoId != nil {
					Picker("Apply to", selection: $draft.scope) {
						Text("This occurrence").tag("occurrence")
						Text("Future series").tag("series")
					}
				}
			}
			Section("Deadline") {
				Toggle("Due date", isOn: $draft.hasDueDate)
				if draft.hasDueDate {
					DatePicker("Date", selection: $draft.date, displayedComponents: .date)
					Toggle("Due time", isOn: $draft.hasTime)
					if draft.hasTime { DatePicker("Time", selection: $draft.time, displayedComponents: .hourAndMinute) }
					TextField("Timezone", text: $draft.timezone)
				}
			}
			Section("Recurrence") {
				Toggle("Repeat", isOn: $draft.repeats).disabled(!draft.hasDueDate)
				if draft.repeats {
					Picker("Repeat from", selection: $draft.recurrenceMode) {
						Text("Calendar schedule").tag("calendar")
						Text("After completion").tag("completion")
					}
					Stepper("Every \(draft.interval)", value: $draft.interval, in: 1...1000)
					Picker("Unit", selection: $draft.recurrenceUnit) {
						ForEach(["day", "week", "month", "year"], id: \.self) { Text($0.capitalized).tag($0) }
					}
					if draft.recurrenceMode == "calendar", draft.recurrenceUnit == "week" {
						ForEach(0..<7, id: \.self) { day in
							Toggle(Calendar.current.weekdaySymbols[day], isOn: Binding(get: { draft.weekdays.contains(day) }, set: {
								if $0 { draft.weekdays.insert(day) } else { draft.weekdays.remove(day) }
							}))
						}
					}
					Toggle("End date", isOn: $draft.hasEndDate)
					if draft.hasEndDate { DatePicker("Last date", selection: $draft.endDate, displayedComponents: .date) }
				}
			}
			if draft.todoId == nil {
				Section("Checklist") {
					TextField("One item per line", text: $draft.checklistText, axis: .vertical).lineLimit(3...8)
				}
			}
		}
		.formStyle(.grouped)
		.environment(\.timeZone, TimeZone(identifier: draft.timezone) ?? .current)
	}
}
