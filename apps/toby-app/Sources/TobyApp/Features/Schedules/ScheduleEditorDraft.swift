import Foundation

struct ScheduleEditorDraft: Equatable, Identifiable {
	var existingId: String?
	var name: String
	var action: String
	var flowId: String
	var prompt: String
	var personaName: String
	var projectId: String
	var cron: String
	var enabled: Bool

	var id: String { existingId ?? "new" }

	var isNew: Bool { existingId == nil }

	var trimmedName: String {
		name.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	var isFlowAction: Bool { action == "flow" }

	var canSave: Bool {
		guard !trimmedName.isEmpty else { return false }
		if isFlowAction {
			return !flowId.isEmpty && flowId != "(none)"
		}
		return true
	}

	static func blank(personaName: String = "") -> ScheduleEditorDraft {
		ScheduleEditorDraft(
			existingId: nil,
			name: "Untitled schedule",
			action: "prompt",
			flowId: "(none)",
			prompt: "",
			personaName: personaName,
			projectId: "(none)",
			cron: "",
			enabled: true
		)
	}

	static func from(schedule: ScheduleViewModel, values: [String: String]) -> ScheduleEditorDraft {
		let prefix = "schedules.\(schedule.id)."
		func value(_ field: ScheduleField, fallback: String) -> String {
			let stored = values[prefix + field.rawValue] ?? fallback
			return stored
		}
		let flowValue = value(.flow, fallback: schedule.flowId ?? "(none)")
		let action = value(.action, fallback: schedule.runsFlow ? "flow" : "prompt")
		let enabledRaw = value(.enabled, fallback: schedule.enabled ? "Yes" : "No")
		return ScheduleEditorDraft(
			existingId: schedule.id,
			name: value(.name, fallback: schedule.name),
			action: action == "flow" ? "flow" : "prompt",
			flowId: flowValue.isEmpty ? "(none)" : flowValue,
			prompt: value(.prompt, fallback: schedule.prompt),
			personaName: value(.persona, fallback: schedule.personaName),
			projectId: value(.project, fallback: schedule.projectId ?? "(none)"),
			cron: value(.cron, fallback: schedule.cronExpression),
			enabled: enabledRaw.lowercased() == "yes"
		)
	}

	func configureChanges(scheduleId: String) -> [String: String] {
		[
			"schedules.\(scheduleId).name": trimmedName,
			"schedules.\(scheduleId).action": isFlowAction ? "flow" : "prompt",
			"schedules.\(scheduleId).flow": isFlowAction ? flowId : "(none)",
			"schedules.\(scheduleId).prompt": prompt,
			"schedules.\(scheduleId).persona": personaName,
			"schedules.\(scheduleId).project": projectId.isEmpty ? "(none)" : projectId,
			"schedules.\(scheduleId).cron": cron,
			"schedules.\(scheduleId).enabled": enabled ? "Yes" : "No",
		]
	}
}
