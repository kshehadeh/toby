import Foundation

/// Builds the default first-turn prompt when starting a chat about a recording.
func makeRecordingChatPrompt(name: String, dateText: String, hourText: String) -> String {
	let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
	let resolvedName = trimmedName.isEmpty ? "Recording" : trimmedName
	return "Summarize the transcript of the recording named \"\(resolvedName)\" on \"\(dateText)\" at \"\(hourText)\" oclock."
}

/// Merges a newly fetched context-window payload with the live turn state so a
/// refresh that omits `fillPercentage` does not clear the gauge mid-session.
func mergeContextWindowPayload(
	current: ContextWindowPayload?,
	incoming: ContextWindowPayload?,
) -> ContextWindowPayload? {
	guard let incoming else { return current }
	guard let current else { return incoming }
	if current.supported,
		incoming.supported,
		current.fillPercentage != nil,
		incoming.fillPercentage == nil
	{
		return ContextWindowPayload(
			supported: true,
			contextWindowTokens: incoming.contextWindowTokens ?? current.contextWindowTokens,
			fillPercentage: current.fillPercentage,
			unavailableReason: nil,
		)
	}
	return incoming
}
