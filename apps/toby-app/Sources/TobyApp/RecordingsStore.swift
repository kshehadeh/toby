import Observation

@Observable
@MainActor
final class RecordingsStore {
	var recordings: [ListenRecordingSummary] = []
	var selectedRecordingIds: Set<String> = []
	var detail: ListenRecordingDetail?
	var isLoading = false
	var isDetailLoading = false
	var isDeletingSelection = false
	var errorMessage: String?
	private let client = TobyClient()

	var selectedRecording: ListenRecordingSummary? {
		guard selectedRecordingIds.count == 1, let id = selectedRecordingIds.first else { return nil }
		return recordings.first { $0.id == id }
	}

	var selectedRecordings: [ListenRecordingSummary] {
		recordings.filter { selectedRecordingIds.contains($0.id) }
	}

	func load() async {
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			recordings = try await client.listRecordings()
			selectedRecordingIds = selectedRecordingIds.intersection(Set(recordings.map(\.id)))
			if selectedRecordingIds.isEmpty {
				selectedRecordingIds = Set(recordings.prefix(1).map(\.id))
			}
			await loadDetailIfNeeded()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectRecording(id: String, holdingCommand: Bool = false) async {
		if holdingCommand {
			if selectedRecordingIds.contains(id) {
				selectedRecordingIds.remove(id)
			} else {
				selectedRecordingIds.insert(id)
			}
		} else {
			selectedRecordingIds = [id]
		}
		await loadDetailIfNeeded()
	}

	private func loadDetailIfNeeded() async {
		guard selectedRecordingIds.count == 1, let id = selectedRecordingIds.first else {
			detail = nil
			return
		}
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
		await deleteRecordings(ids: [id])
	}

	func deleteRecordings(ids: [String]) async {
		guard !ids.isEmpty, !isDeletingSelection else { return }
		isDeletingSelection = true
		errorMessage = nil
		defer { isDeletingSelection = false }
		do {
			for id in ids {
				try await client.deleteRecording(id: id)
			}
			recordings = try await client.listRecordings()
			selectedRecordingIds = Set(recordings.prefix(1).map(\.id))
			await loadDetailIfNeeded()
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}
