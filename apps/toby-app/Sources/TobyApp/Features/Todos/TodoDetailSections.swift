import SwiftUI

struct TodoChecklistSection: View {
	@Bindable var store: TodosStore
	let todo: TobyTodo
	let isEditable: Bool
	@State private var newItem = ""

	var body: some View {
		DetailSection(title: "Checklist") {
			ForEach(todo.checklist) { item in
				HStack {
					Toggle(item.text, isOn: Binding(
						get: { item.checked },
						set: { checked in Task { await store.setChecklistItem(item, checked: checked, on: todo) } }
					))
					Spacer()
					if isEditable {
						Button("Remove \(item.text)", systemImage: "minus.circle") {
							Task { await store.removeChecklistItem(item, from: todo) }
						}
						.labelStyle(.iconOnly)
						.buttonStyle(.borderless)
						.help("Remove item")
					}
				}
				.disabled(!isEditable || store.isSaving)
			}
			if !todo.checklist.isEmpty {
				Text("\(todo.checklist.filter(\.checked).count) of \(todo.checklist.count) done")
					.font(.caption).foregroundStyle(AppTheme.secondaryText)
			}
			if isEditable {
				HStack {
					TextField("Add an item", text: $newItem)
						.textFieldStyle(.roundedBorder)
						.onSubmit(add)
						.accessibilityIdentifier("todo-checklist-new")
					Button("Add", action: add)
						.disabled(newItem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
				}
			}
		}
	}

	private func add() {
		let text = newItem
		newItem = ""
		Task { await store.addChecklistItem(text, to: todo) }
	}
}

struct TodoRemindersSection: View {
	@Bindable var store: TodosStore
	let todo: TobyTodo
	let isEditable: Bool
	@State private var isPickingTime = false
	@State private var customTime = Date().addingTimeInterval(3600)

	static let offsets: [(title: String, minutes: Int)] = [
		("At due time", 0), ("15 minutes before", 15), ("1 hour before", 60), ("1 day before", 1440),
	]

	var body: some View {
		DetailSection(title: "Reminders") {
			if todo.reminders.isEmpty {
				Text(todo.due?.time == nil ? "No reminders. Date-only todos need a specific reminder time." : "No reminders.")
					.font(.callout).foregroundStyle(AppTheme.secondaryText)
			}
			ForEach(todo.reminders) { reminder in
				HStack {
					Image(systemName: "bell").foregroundStyle(AppTheme.secondaryText).accessibilityHidden(true)
					Text(reminder.label).font(.callout)
					Spacer()
					if isEditable {
						Menu("Snooze") {
							Button("For 1 hour") { snooze(reminder, until: Date().addingTimeInterval(3600)) }
							Button("Until tomorrow morning") { snooze(reminder, until: Self.tomorrowMorning()) }
						}
						.fixedSize()
						Button("Remove reminder", systemImage: "minus.circle") {
							Task { await store.removeReminder(reminder, from: todo) }
						}
						.labelStyle(.iconOnly)
						.buttonStyle(.borderless)
						.help("Remove reminder")
					}
				}
			}
			if isEditable {
				Menu("Add reminder", systemImage: "bell.badge") {
					if todo.due?.time != nil {
						ForEach(Self.offsets, id: \.minutes) { option in
							Button(option.title) { Task { await store.addReminder(to: todo, offsetMinutes: option.minutes) } }
						}
						Divider()
					}
					Button("At a specific time…") { isPickingTime = true }
				}
				.fixedSize()
				.disabled(store.isSaving)
				.accessibilityIdentifier("todo-add-reminder")
				.popover(isPresented: $isPickingTime) {
					VStack(alignment: .leading, spacing: 12) {
						DatePicker("Remind me", selection: $customTime, in: Date()...)
						HStack {
							Spacer()
							Button("Cancel", role: .cancel) { isPickingTime = false }
							Button("Add") {
								isPickingTime = false
								let date = customTime
								Task { await store.addReminder(to: todo, at: date) }
							}
							.keyboardShortcut(.defaultAction)
						}
					}
					.padding()
					.frame(width: 320)
				}
			}
		}
	}

	private func snooze(_ reminder: TodoReminder, until date: Date) {
		Task { await store.snoozeReminder(reminder, on: todo, until: date) }
	}

	static func tomorrowMorning(now: Date = Date(), calendar: Calendar = .current) -> Date {
		let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
		return calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
	}
}

struct TodoHistoryList: View {
	@Bindable var store: TodosStore
	let todo: TobyTodo

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			if store.history.isEmpty {
				Text("No history loaded.").font(.callout).foregroundStyle(AppTheme.secondaryText)
			}
			ForEach(store.history) { entry in
				HStack(alignment: .top) {
					VStack(alignment: .leading, spacing: 2) {
						Text(entry.fieldTitle).font(.callout.weight(.medium))
						Text(entry.valueText).font(.callout).foregroundStyle(AppTheme.secondaryText).lineLimit(3).textSelection(.enabled)
						Text("\(Self.timestamp(entry.at)) · \(entry.source)").font(.caption).foregroundStyle(AppTheme.tertiaryText)
					}
					Spacer()
					if entry.current {
						Text("Current").font(.caption).foregroundStyle(AppTheme.secondaryText)
					} else if entry.restorable && !todo.deleted && todo.state.status == "open" {
						Button("Restore") { Task { await store.restoreField(entry, on: todo) } }
							.disabled(store.isSaving)
							.help("Apply this earlier value as a new edit")
							.accessibilityLabel("Restore \(entry.fieldTitle.lowercased()) to \(entry.valueText)")
					}
				}
			}
		}
		.padding(.top, 6)
	}

	static func timestamp(_ value: String) -> String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		guard let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return value }
		return date.formatted(date: .abbreviated, time: .shortened)
	}
}
