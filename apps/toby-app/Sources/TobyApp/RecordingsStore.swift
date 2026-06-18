import Observation

@Observable
@MainActor
final class RecordingsStore {
	var recordings: [ListenRecordingSummary] = []
	var selectedRecordingId: String?
	var detail: ListenRecordingDetail?
	var isLoading = false
	var isDetailLoading = false
	var deletingRecordingId: String?
	var errorMessage: String?
	private let client = TobyClient()

	var selectedRecording: ListenRecordingSummary? {
		guard let selectedRecordingId else { return nil }
		return recordings.first { $0.id == selectedRecordingId }
	}

	func load() async {
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			recordings = try await client.listRecordings()
			if selectedRecordingId == nil || !recordings.contains(where: { $0.id == selectedRecordingId }) {
				selectedRecordingId = recordings.first?.id
			}
			if let selectedRecordingId {
				await selectRecording(id: selectedRecordingId)
			} else {
				detail = nil
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectRecording(id: String) async {
		selectedRecordingId = id
		isDetailLoading = true
		errorMessage = nil
		defer { isDetailLoading = false }
		do {
			detail = try await client.fetchRecording(id: id)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func deleteRecording(id: String) async {
		guard deletingRecordingId == nil else { return }
		deletingRecordingId = id
		errorMessage = nil
		defer { deletingRecordingId = nil }

		do {
			try await client.deleteRecording(id: id)
			recordings = try await client.listRecordings()

			guard selectedRecordingId == id else { return }
			selectedRecordingId = recordings.first?.id
			detail = nil
			if let selectedRecordingId {
				await selectRecording(id: selectedRecordingId)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}
