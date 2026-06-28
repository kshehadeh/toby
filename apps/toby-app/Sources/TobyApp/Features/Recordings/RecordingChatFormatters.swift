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
