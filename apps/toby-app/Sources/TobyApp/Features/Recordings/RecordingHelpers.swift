import Foundation

func isNonFatalScreenCaptureDecline(_ message: String) -> Bool {
	message.contains("SCStreamErrorDomain")
		&& message.contains("Code=-3801")
		&& message.localizedCaseInsensitiveContains("declined")
}

func recordingSummary(_ recording: ListenRecordingSummary) -> String {
	let duration = durationText(recording.durationMs)
	let transcript = recording.hasTranscript ? " · Transcript" : ""
	if hasRecordingName(recording) {
		let startedAt = friendlyRecordingDate(recording.startedAt, fallback: recording.createdAt)
		return "\(startedAt) · \(duration)\(transcript)"
	}
	return "\(duration)\(transcript)"
}

func recordingSidebarTitle(_ recording: ListenRecordingSummary) -> String {
	if let name = normalizedRecordingName(recording) {
		return name
	}
	return friendlyRecordingDate(recording.startedAt, fallback: recording.createdAt)
}

func hasRecordingName(_ recording: ListenRecordingSummary) -> Bool {
	normalizedRecordingName(recording) != nil
}

func normalizedRecordingName(_ recording: ListenRecordingSummary) -> String? {
	guard let name = recording.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
		return nil
	}
	return name
}

func friendlyRecordingDate(_ value: String, fallback: String) -> String {
	guard let date = isoRecordingDate(value) ?? isoRecordingDate(fallback) else {
		return value.isEmpty ? fallback : value
	}
	return RecordingDateFormatters.friendly.string(from: date)
}

func isoRecordingDate(_ value: String) -> Date? {
	let fractional = ISO8601DateFormatter()
	fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
	return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

func durationText(_ durationMs: Int?) -> String {
	guard let durationMs else { return "Unknown duration" }
	let seconds = max(0, durationMs / 1000)
	let minutes = seconds / 60
	let remainder = seconds % 60
	return "\(minutes):\(String(format: "%02d", remainder))"
}

func playbackTimeText(_ time: TimeInterval) -> String {
	let totalSeconds = max(0, Int(time.rounded()))
	let hours = totalSeconds / 3600
	let minutes = (totalSeconds % 3600) / 60
	let seconds = totalSeconds % 60
	if hours > 0 {
		return "\(hours):\(String(format: "%02d", minutes)):\(String(format: "%02d", seconds))"
	}
	return "\(minutes):\(String(format: "%02d", seconds))"
}

func sourceText(_ sources: ListenSourceSelection) -> String {
	switch (sources.mic, sources.system) {
	case (true, true):
		return "Microphone + System audio"
	case (true, false):
		return "Microphone"
	case (false, true):
		return "System audio"
	default:
		return "None"
	}
}

enum RecordingDateFormatters {
	static let friendly: DateFormatter = {
		let formatter = DateFormatter()
		formatter.dateStyle = .medium
		formatter.timeStyle = .short
		return formatter
	}()
}
