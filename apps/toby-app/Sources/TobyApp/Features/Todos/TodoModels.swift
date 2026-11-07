import Foundation

struct TobyTodo: Decodable, Equatable, Sendable {
	let id: String
	let revision: String
	let title: String
	let description: String
	let priority: String
	let listId: String
	let projectId: String?
	let projectLabel: String?
	let tags: [String]
	let due: TodoDue?
	let recurrence: TodoRecurrence?
	let deleted: Bool
	let occurrenceId: String
	let sequence: Int
	let state: TodoOccurrenceState
	let checklist: [TodoChecklistItem]
	let reminders: [TodoReminder]

	var dueLabel: String {
		guard let due else { return "No due date" }
		return [due.date, due.time, due.time == nil ? nil : due.timezone].compactMap { $0 }.joined(separator: " · ")
	}
}

struct TodoDue: Codable, Equatable, Sendable {
	var date: String
	var time: String?
	var timezone: String
}

struct TodoRecurrence: Codable, Equatable, Sendable {
	var mode: String
	var unit: String
	var interval: Int
	var weekdays: [Int]?
	var endDate: String?
}

struct TodoOccurrenceState: Decodable, Equatable, Sendable {
	let status: String
	let at: String?
}

struct TodoChecklistItem: Codable, Identifiable, Equatable, Sendable {
	let id: String
	var text: String
	var order: Double
	var checked: Bool
}

struct TodoReminder: Codable, Identifiable, Equatable, Sendable {
	let id: String
	let at: String?
	let offsetMinutes: Int?
	let snoozedUntil: String?
}

struct TodoOrganizationItem: Decodable, Identifiable, Equatable, Sendable {
	static let inboxId = "inbox"
	let id: String
	let name: String
}

struct TodoPage: Decodable, Sendable {
	let todos: [TobyTodo]
	let total: Int
}

struct TodoSyncStatus: Decodable, Equatable, Sendable {
	let pausedForRestore: Bool
	let lastSuccess: String?
	let error: String?
	var pending: Int? = nil
}

/// One field edit from the todo journal. Superseded values can be restored as a new edit.
struct TodoHistoryEntry: Decodable, Identifiable, Equatable, Sendable {
	let operationId: String
	let at: String
	let source: String
	let kind: String
	let entityId: String
	let field: String
	let valueText: String
	let current: Bool
	let restorable: Bool
	var id: String { "\(operationId)|\(entityId)|\(field)" }

	private enum CodingKeys: String, CodingKey {
		case operationId, at, source, kind, entityId, field, value, current, restorable
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		operationId = try container.decode(String.self, forKey: .operationId)
		at = try container.decode(String.self, forKey: .at)
		source = try container.decode(String.self, forKey: .source)
		kind = try container.decode(String.self, forKey: .kind)
		entityId = try container.decode(String.self, forKey: .entityId)
		field = try container.decode(String.self, forKey: .field)
		current = try container.decode(Bool.self, forKey: .current)
		restorable = try container.decode(Bool.self, forKey: .restorable)
		let value = try container.decodeIfPresent(AnyCodable.self, forKey: .value)?.value ?? NSNull()
		valueText = Self.describe(value, field: field)
	}

	var fieldTitle: String {
		if field.hasPrefix("check:") { return "Checklist item" }
		if field.hasPrefix("tag:") { return "Tag" }
		if field.hasPrefix("reminder:") { return "Reminder" }
		switch field {
		case "anchor": return "Series due date"
		case "due": return "Due date"
		case "state": return "Status"
		case "listId": return "List"
		case "projectId": return "Project"
		case "projectLabel": return "Project name"
		case "createdAt": return "Created"
		default: return field.prefix(1).uppercased() + field.dropFirst()
		}
	}

	static func describe(_ value: Any, field: String) -> String {
		if value is NSNull { return field.hasPrefix("check:") || field.hasPrefix("reminder:") ? "Removed" : "None" }
		if let bool = value as? Bool {
			if field.hasPrefix("tag:") { return bool ? "Added" : "Removed" }
			return bool ? "Yes" : "No"
		}
		if let string = value as? String { return string.isEmpty ? "Empty" : string }
		if let dictionary = value as? [String: Any] {
			if let text = dictionary["text"] as? String {
				return "\(dictionary["checked"] as? Bool == true ? "Done" : "Not done"): \(text)"
			}
			if let status = dictionary["status"] as? String { return status.capitalized }
			if let date = dictionary["date"] as? String {
				return [date, dictionary["time"] as? String, dictionary["timezone"] as? String].compactMap { $0 }.joined(separator: " ")
			}
		}
		if JSONSerialization.isValidJSONObject(value),
			let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
			let text = String(data: data, encoding: .utf8) { return text }
		return String(describing: value)
	}
}

extension TodoReminder {
	/// Readable reminder time; the daemon stores absolute instants as ISO-8601 UTC.
	var label: String {
		if let snoozedUntil, let date = ISO8601DateFormatter().date(from: snoozedUntil) {
			return "Snoozed until \(date.formatted(date: .abbreviated, time: .shortened))"
		}
		if let at, let date = ISO8601DateFormatter().date(from: at) {
			return date.formatted(date: .abbreviated, time: .shortened)
		}
		switch offsetMinutes ?? 0 {
		case 0: return "At due time"
		case let minutes where minutes % 1440 == 0: return "\(minutes / 1440) day\(minutes == 1440 ? "" : "s") before due"
		case let minutes where minutes % 60 == 0: return "\(minutes / 60) hour\(minutes == 60 ? "" : "s") before due"
		case let minutes: return "\(minutes) minutes before due"
		}
	}
}

enum TodoViewFilter: String, CaseIterable, Identifiable {
	case inbox, today, upcoming, allOpen, completed, deleted
	var id: String { rawValue }
	var title: String {
		switch self {
		case .inbox: "Inbox"
		case .today: "Today"
		case .upcoming: "Upcoming"
		case .allOpen: "All open"
		case .completed: "Completed"
		case .deleted: "Recently deleted"
		}
	}
}
