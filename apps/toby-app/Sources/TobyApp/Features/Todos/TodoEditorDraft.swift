import Foundation

struct TodoEditorDraft: Identifiable, Equatable, Sendable {
	let id: String
	let todoId: String?
	let revision: String?
	var title = ""
	var description = ""
	var priority = "none"
	var listId = "inbox"
	var projectId = ""
	var projectLabel: String?
	var hasDueDate = false
	var date = Date()
	var hasTime = false
	var time = Date()
	var timezone = TimeZone.current.identifier
	var repeats = false
	var recurrenceMode = "calendar"
	var recurrenceUnit = "day"
	var interval = 1
	var weekdays: Set<Int> = []
	var hasEndDate = false
	var endDate = Date()
	var scope = "occurrence"
	var checklistText = ""

	init(todo: TobyTodo? = nil, projectId: String = "", projectLabel: String? = nil) {
		id = UUID().uuidString
		todoId = todo?.id
		revision = todo?.revision
		self.projectId = projectId
		self.projectLabel = projectLabel
		guard let todo else { return }
		title = todo.title
		description = todo.description
		priority = todo.priority
		listId = todo.listId
		self.projectId = todo.projectId ?? ""
		self.projectLabel = todo.projectLabel
		if let due = todo.due {
			hasDueDate = true
			timezone = due.timezone
			date = Self.dateFormatter(timezone: due.timezone).date(from: due.date) ?? Date()
			if let dueTime = due.time {
				hasTime = true
				let formatter = Self.dateFormatter(timezone: due.timezone)
				formatter.dateFormat = "yyyy-MM-dd HH:mm"
				time = formatter.date(from: "\(due.date) \(dueTime)") ?? date
			}
		}
		if let recurrence = todo.recurrence {
			repeats = true
			recurrenceMode = recurrence.mode
			recurrenceUnit = recurrence.unit
			interval = recurrence.interval
			weekdays = Set(recurrence.weekdays ?? [])
			if let end = recurrence.endDate {
				hasEndDate = true
				endDate = Self.dateFormatter(timezone: timezone).date(from: end) ?? Date()
			}
		}
	}

	var canSave: Bool {
		!title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
			(!repeats || hasDueDate) && TimeZone(identifier: timezone) != nil
	}

	func fields() -> [String: Any] {
		var fields: [String: Any] = [
			"title": title, "description": description, "priority": priority,
			"listId": listId, "projectId": projectId.isEmpty ? NSNull() : projectId,
			"projectLabel": projectLabel ?? NSNull(),
			"due": NSNull(), "recurrence": NSNull(),
		]
		if hasDueDate {
			let formatter = Self.dateFormatter(timezone: timezone)
			var due: [String: Any] = ["date": formatter.string(from: date), "timezone": timezone, "time": NSNull()]
			if hasTime {
				formatter.dateFormat = "HH:mm"
				due["time"] = formatter.string(from: time)
			}
			fields["due"] = due
		}
		if repeats {
			var recurrence: [String: Any] = ["mode": recurrenceMode, "unit": recurrenceUnit, "interval": interval]
			if recurrenceMode == "calendar", recurrenceUnit == "week", !weekdays.isEmpty {
				recurrence["weekdays"] = weekdays.sorted()
			}
			if hasEndDate { recurrence["endDate"] = Self.dateFormatter(timezone: timezone).string(from: endDate) }
			fields["recurrence"] = recurrence
		}
		if todoId != nil { fields["scope"] = scope }
		else {
			fields["checklist"] = checklistText.components(separatedBy: .newlines)
				.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
		}
		return fields
	}

	static func dateFormatter(timezone: String) -> DateFormatter {
		let formatter = DateFormatter()
		formatter.calendar = Calendar(identifier: .gregorian)
		formatter.locale = Locale(identifier: "en_US_POSIX")
		formatter.timeZone = TimeZone(identifier: timezone) ?? .current
		formatter.dateFormat = "yyyy-MM-dd"
		return formatter
	}
}
