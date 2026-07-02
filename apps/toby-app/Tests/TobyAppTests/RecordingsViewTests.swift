import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("RecordingsView")
struct RecordingsViewTests {
	@Test("recordings view renders detail content")
	func recordingsViewRendersDetailContent() throws {
		let view = RecordingsView(store: RecordingsStore())
		#expect(throws: Never.self) { try view.inspect().find(RecordingsDetailView.self) }
	}

	@Test("recordings store tracks multiple selected recordings")
	func recordingsStoreTracksMultipleSelections() {
		let store = RecordingsStore()
		let first = makeRecording(id: "r1", name: "First")
		let second = makeRecording(id: "r2", name: "Second")
		store.recordings = [first, second]
		store.selectedRecordingIds = ["r1", "r2"]
		#expect(store.selectedRecordings.count == 2)
		#expect(store.selectedRecording == nil)
		store.selectedRecordingIds = ["r1"]
		#expect(store.selectedRecordings.count == 1)
		#expect(store.selectedRecording?.id == "r1")
	}

	@Test("recordings detail shows deck when multiple recordings are selected")
	func recordingsDetailShowsDeckWhenMultipleSelected() throws {
		let store = RecordingsStore()
		store.recordings = [
			makeRecording(id: "r1", name: "One"),
			makeRecording(id: "r2", name: "Two"),
			makeRecording(id: "r3", name: "Three"),
		]
		store.selectedRecordingIds = ["r1", "r2", "r3"]
		let view = RecordingsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "3 recordings selected")
		}
	}

	@Test("recordings detail shows copy transcript button when transcript is present")
	func recordingsDetailShowsCopyTranscriptButton() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: "One")]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: "Hello world transcript")
		let view = RecordingsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "copy-transcript-button")
		}
	}

	@Test("recordings detail hides copy transcript button when transcript is absent")
	func recordingsDetailHidesCopyTranscriptButtonWhenAbsent() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: "One")]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: nil)
		let view = RecordingsView(store: store)
		#expect(throws: Error.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "copy-transcript-button")
		}
	}

	@Test("sidebar row shows processing stage text when recording is processing")
	func sidebarRowShowsProcessingStage() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: "One")]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: nil)
		let processing = RecordingProcessingState(
			recordingId: "r1",
			stage: .transcribing,
			message: "Transcribing audio…"
		)
		let view = RecordingsView(store: store, processingState: processing)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Transcribing audio…")
		}
	}

	@Test("sidebar row does not show processing stage when recording is not processing")
	func sidebarRowHidesProcessingStageWhenNotProcessing() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: "One")]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: nil)
		let processing = RecordingProcessingState(
			recordingId: "r2",
			stage: .transcribing,
			message: "Transcribing audio…"
		)
		let view = RecordingsView(store: store, processingState: processing)
		#expect(throws: Error.self) {
			try view.inspect().find(text: "Transcribing audio…")
		}
	}

	@Test("detail view shows processing card when selected recording is processing")
	func detailViewShowsProcessingCard() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: "One")]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: nil)
		let processing = RecordingProcessingState(
			recordingId: "r1",
			stage: .transcribing,
			message: "Transcribing audio…"
		)
		let view = RecordingsView(store: store, processingState: processing)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Processing recording")
		}
	}

	@Test("detail view does not show processing card when no processing state")
	func detailViewHidesProcessingCardWhenIdle() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: "One")]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: nil)
		let view = RecordingsView(store: store)
		#expect(throws: Error.self) {
			try view.inspect().find(text: "Processing recording")
		}
	}

	@Test("detail view shows editable name field in sidebar when a single recording is selected")
	func detailViewShowsEditableNameField() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: "One")]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: nil)
		let view = RecordingsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "recording-name-field")
		}
	}

	@Test("detail view shows start chat button in sidebar when a single recording is selected")
	func detailViewShowsStartChatButton() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: "One")]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: "Hello world transcript")
		let view = RecordingsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "sidebar-start-chat-button")
		}
	}

	@Test("detail view shows delete button in sidebar when a single recording is selected")
	func detailViewShowsDeleteButton() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: "One")]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: nil)
		let view = RecordingsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "sidebar-delete-recording-button")
		}
	}

	@Test("detail view shows transcript column header")
	func detailViewShowsTranscriptHeader() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: "One")]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: "Hello world transcript")
		let view = RecordingsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Transcript")
		}
	}

	@Test("recording chat date and hour are derived from started timestamp")
	func recordingChatDateAndHourDerivesValues() {
		let detail = makeRecordingDetail(id: "r1", transcript: nil, name: "One")
		let (date, hour) = recordingChatDateAndHour(detail)
		#expect(!date.isEmpty)
		#expect(!hour.isEmpty)
	}

	@Test("detail view shows recording name in header")
	func detailViewShowsRecordingName() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: "My Standup")]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: nil, name: "My Standup")
		let view = RecordingsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "My Standup")
		}
	}

	@Test("detail view shows fallback title when recording has no name")
	func detailViewShowsFallbackTitle() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: nil)]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: nil)
		let view = RecordingsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Recording")
		}
	}

	@Test("detail view updates title after rename")
	func detailViewUpdatesTitleAfterRename() throws {
		let store = RecordingsStore()
		store.recordings = [makeRecording(id: "r1", name: nil)]
		store.selectedRecordingIds = ["r1"]
		store.detail = makeRecordingDetail(id: "r1", transcript: nil, name: nil)
		let view = RecordingsView(store: store)

		// Before rename, the detail header shows the fallback "Recording"
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Recording")
		}

		// Simulate what renameRecording does after a successful server call:
		// update both detail and recordings with the new name
		store.detail = makeRecordingDetail(id: "r1", transcript: nil, name: "Team Sync")
		store.recordings = [makeRecording(id: "r1", name: "Team Sync")]

		// After rename, the detail header should show "Team Sync"
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Team Sync")
		}
	}
}

private func makeRecording(id: String, name: String? = nil) -> ListenRecordingSummary {
	ListenRecordingSummary(
		id: id,
		dir: "/tmp/\(id)",
		name: name,
		description: nil,
		createdAt: "2026-06-22T10:00:00Z",
		startedAt: "2026-06-22T10:00:00Z",
		stoppedAt: nil,
		durationMs: 60000,
		sources: ListenSourceSelection(mic: true, system: false),
		hasAudio: true,
		hasTranscript: false
	)
}

private func makeRecordingDetail(
	id: String,
	transcript: String?,
	name: String? = nil
) -> ListenRecordingDetail {
	ListenRecordingDetail(
		id: id,
		dir: "/tmp/\(id)",
		metadata: ListenRecordingMetadata(
			id: id,
			name: name,
			description: nil,
			createdAt: "2026-06-22T10:00:00Z",
			startedAt: "2026-06-22T10:00:00Z",
			stoppedAt: nil,
			durationMs: 60000,
			sources: ListenSourceSelection(mic: true, system: false),
			errors: nil
		),
		hasAudio: false,
		audioPath: nil,
		hasTranscript: transcript != nil,
		transcript: transcript,
		transcriptError: nil,
		warnings: nil
	)
}
