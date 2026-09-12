import Foundation

enum RecordingChatFormatters {
	static let date: DateFormatter = {
		let formatter = DateFormatter()
		formatter.dateStyle = .long
		formatter.timeStyle = .none
		return formatter
	}()

	static let hour: DateFormatter = {
		let formatter = DateFormatter()
		formatter.setLocalizedDateFormatFromTemplate("ha")
		return formatter
	}()
}

func recordingChatDateAndHour(_ detail: ListenRecordingDetail) -> (date: String, hour: String) {
	let value = detail.metadata.startedAt
	let fallback = detail.metadata.createdAt
	guard let date = isoRecordingDate(value) ?? isoRecordingDate(fallback) else {
		return (value.isEmpty ? fallback : value, "")
	}
	return (RecordingChatFormatters.date.string(from: date), RecordingChatFormatters.hour.string(from: date))
}

/// Returns the recording's linked chat session when it still exists in the session list.
func existingRecordingChatSessionId(
	chatSessionId: String?,
	validSessionIds: Set<String>,
) -> String? {
	guard let sessionId = chatSessionId, validSessionIds.contains(sessionId) else { return nil }
	return sessionId
}

func startChatAboutRecordingRequest(from detail: ListenRecordingDetail) -> StartChatAboutRecordingRequest {
	let (dateText, hourText) = recordingChatDateAndHour(detail)
	return StartChatAboutRecordingRequest(
		recordingId: detail.id,
		name: detail.metadata.name ?? "Recording",
		dateText: dateText,
		hourText: hourText,
	)
}
