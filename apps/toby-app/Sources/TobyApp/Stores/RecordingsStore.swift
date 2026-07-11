import Foundation
import Observation

@Observable
@MainActor
final class RecordingsStore {
	var recordings: [ListenRecordingSummary] = []
	var selectedRecordingIds: Set<String> = []
	var pendingDeleteRecordingIds: Set<String> = []
	var detail: ListenRecordingDetail?
	var isLoading = false
	var isDetailLoading = false
	var isDeletingSelection = false
	var hasLoadedOnce = false
	var lastLoadedAt: Date?
	var errorMessage: String?

	/// ID of an in-progress recording selected in the sidebar. Distinct from
	/// `selectedRecordingIds` because active recordings are not yet persisted.
	var selectedActiveRecordingId: String?

	/// Manual transcription processing state (from the Transcribe / Re-Transcribe
	/// button in the recording detail sidebar). Distinct from the post-recording
	/// processing state owned by `ChatStore`.
	var transcriptionProcessing: RecordingProcessingState?

	/// Recording id currently being summarized (Summarize / Re-Summarize button).
	var summarizingRecordingId: String?

	private let client = TobyClient()

	var selectedRecording: ListenRecordingSummary? {
		guard selectedRecordingIds.count == 1, let id = selectedRecordingIds.first else { return nil }
		return recordings.first { $0.id == id }
	}

	var selectedRecordings: [ListenRecordingSummary] {
		recordings.filter { selectedRecordingIds.contains($0.id) }
	}

	func load() async {
		guard !isLoading else { return }
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			try await loadListData()
			await loadDetailIfNeeded()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func loadList() async {
		guard !isLoading else { return }
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			try await loadListData()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func ensureLoaded() async {
		if hasLoadedOnce {
			await loadDetailIfNeeded()
			return
		}
		await load()
	}

	func ensureListLoaded() async {
		guard !hasLoadedOnce else { return }
		await loadList()
	}

	func selectRecording(id: String, holdingCommand: Bool = false) async {
		selectedActiveRecordingId = nil
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

	/// Select an in-progress (active) recording. Clears saved selection and
	/// detail without attempting a server fetch — active recordings are not
	/// available from the recordings API until after stop/save.
	func selectActiveRecording(id: String) {
		// Set active selection first so the detail pane prefers the live
		// recording view before we clear saved selection / detail. Avoids a
		// brief window where RecordingDetailContent is still mounted against a
		// nil `detail`.
		selectedActiveRecordingId = id
		selectedRecordingIds = []
		detail = nil
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

	private func loadListData() async throws {
		recordings = try await client.listRecordings()
		selectedRecordingIds = selectedRecordingIds.intersection(Set(recordings.map(\.id)))
		if selectedRecordingIds.isEmpty {
			selectedRecordingIds = Set(recordings.prefix(1).map(\.id))
		}
		hasLoadedOnce = true
		lastLoadedAt = Date()
	}

	func deleteRecording(id: String) async {
		await deleteRecordings(ids: [id])
	}

	func renameRecording(id: String, name: String) async {
		let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
		let newName = trimmed.isEmpty ? nil : trimmed

		// Optimistic update: immediately reflect the new name in detail and
		// recordings so the UI updates without waiting for the server round-trip.
		// This also prevents a race where a concurrent loadDetailIfNeeded()
		// overwrites the detail after the PATCH response arrives.
		if let currentDetail = detail, currentDetail.id == id {
			detail = ListenRecordingDetail(
				id: currentDetail.id,
				dir: currentDetail.dir,
				metadata: ListenRecordingMetadata(
					id: currentDetail.metadata.id,
					name: newName,
					description: currentDetail.metadata.description,
					createdAt: currentDetail.metadata.createdAt,
					startedAt: currentDetail.metadata.startedAt,
					stoppedAt: currentDetail.metadata.stoppedAt,
					durationMs: currentDetail.metadata.durationMs,
					sources: currentDetail.metadata.sources,
					errors: currentDetail.metadata.errors,
					chatSessionId: currentDetail.metadata.chatSessionId,
					summary: currentDetail.metadata.summary
				),
				hasAudio: currentDetail.hasAudio,
				audioPath: currentDetail.audioPath,
				hasTranscript: currentDetail.hasTranscript,
				transcript: currentDetail.transcript,
				transcriptError: currentDetail.transcriptError,
				warnings: currentDetail.warnings,
				hasSummary: currentDetail.hasSummary,
				summary: currentDetail.summary,
				summaryMeta: currentDetail.summaryMeta
			)
		}
		if let idx = recordings.firstIndex(where: { $0.id == id }) {
			let existing = recordings[idx]
			recordings[idx] = ListenRecordingSummary(
				id: existing.id,
				dir: existing.dir,
				name: newName,
				description: existing.description,
				createdAt: existing.createdAt,
				startedAt: existing.startedAt,
				stoppedAt: existing.stoppedAt,
				durationMs: existing.durationMs,
				sources: existing.sources,
				hasAudio: existing.hasAudio,
				hasTranscript: existing.hasTranscript,
				hasSummary: existing.hasSummary
			)
		}

		do {
			detail = try await client.updateRecording(id: id, name: newName)
		} catch {
			errorMessage = error.localizedDescription
		}
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

	/// Run (or re-run) transcription for a recording via the SSE streaming
	/// endpoint. Updates `transcriptionProcessing` through the same stages used
	/// after a live recording stops.
	func transcribeRecording(id: String) async {
		guard transcriptionProcessing?.isActive != true else { return }
		transcriptionProcessing = RecordingProcessingState(
			recordingId: id,
			stage: .preparingTranscription,
		)

		do {
			_ = try await client.streamTranscribeRecording(id: id) { message in
				Task { @MainActor in
					guard self.transcriptionProcessing?.recordingId == id,
						self.transcriptionProcessing?.isActive == true else { return }
					self.transcriptionProcessing?.stage = .transcribing
					self.transcriptionProcessing?.message = message
				}
			}
			transcriptionProcessing = RecordingProcessingState(
				recordingId: id,
				stage: .complete,
				message: "Transcription complete.",
			)
		} catch {
			transcriptionProcessing = RecordingProcessingState(
				recordingId: id,
				stage: .failed,
				message: error.localizedDescription,
			)
			errorMessage = error.localizedDescription
		}

		// Reload the recordings list and selected detail so the UI reflects the
		// new transcript (or error) without a manual refresh.
		await load()
		if selectedRecordingIds.contains(id) {
			await selectRecording(id: id)
		}
	}

	/// Generate (or regenerate) an AI summary for a transcribed recording.
	func summarizeRecording(id: String) async {
		guard summarizingRecordingId == nil else { return }
		summarizingRecordingId = id
		errorMessage = nil
		defer {
			if summarizingRecordingId == id {
				summarizingRecordingId = nil
			}
		}

		do {
			let updated = try await client.summarizeRecording(id: id)
			if selectedRecordingIds.contains(id) {
				detail = updated
			}
			// Refresh list so hasSummary badges stay in sync.
			if let list = try? await client.listRecordings() {
				recordings = list
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}
