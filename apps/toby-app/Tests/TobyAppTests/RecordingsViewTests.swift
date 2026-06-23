import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("RecordingsView")
struct RecordingsViewTests {
	@Test("recordings view uses navigation split view with sidebar")
	func recordingsViewUsesNavigationSplitView() throws {
		let view = RecordingsView(store: RecordingsStore())
		let splitView = try view.inspect().navigationSplitView()
		#expect(throws: Never.self) { try splitView.sidebarView() }
		#expect(throws: Never.self) { try splitView.detailView() }
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
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "delete-recordings-button")
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

private func makeRecordingDetail(id: String, transcript: String?) -> ListenRecordingDetail {
	ListenRecordingDetail(
		id: id,
		dir: "/tmp/\(id)",
		metadata: ListenRecordingMetadata(
			id: id,
			name: nil,
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
