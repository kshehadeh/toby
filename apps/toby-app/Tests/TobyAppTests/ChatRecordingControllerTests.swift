import Foundation
import Testing
@testable import TobyApp

@MainActor
@Suite("ChatRecordingController")
struct ChatRecordingControllerTests {
	private func makeState(
		activityLine: String = "Ready",
		listenStatus: ListenStatusResponse? = nil,
	) -> ChatRecordingUIState {
		ChatRecordingUIState(
			listenStatus: listenStatus,
			recordingProcessing: nil,
			toast: nil,
			activityLine: activityLine,
		)
	}

	@Test("unconfigured transcription toast opens settings")
	func unconfiguredToast() {
		let toast = ChatRecordingController.unconfiguredTranscriptionToast()
		#expect(toast.style == .error)
		#expect(toast.action == .openSettings(navKey: "transcription"))
	}

	@Test("completion toast prefers first error over success")
	func completionToastError() {
		let toast = ChatRecordingController.completionToast(
			recordingId: "r1",
			errors: ["  boom  ", "ignored"],
		)
		#expect(toast.style == .error)
		#expect(toast.title == "Recording issue")
		#expect(toast.message == "boom")
		#expect(toast.action == nil)
	}

	@Test("completion toast success opens recording")
	func completionToastSuccess() {
		let toast = ChatRecordingController.completionToast(recordingId: "r1", errors: nil)
		#expect(toast.style == .success)
		#expect(toast.action == .openRecording(id: "r1"))
	}

	@Test("applyStoppingCapture leaves live capture and starts generating stage")
	func applyStoppingCapture() {
		let current = ListenStatusResponse(
			status: "recording",
			session: ListenSessionInfo(
				id: "s1",
				startedAt: "2026-01-01T00:00:00Z",
				sources: ListenSourceSelection(mic: true, system: false),
			),
			outputDir: "/tmp/out",
			message: nil,
			error: nil,
		)
		var state = makeState(listenStatus: current)
		ChatRecordingController.applyStoppingCapture(current: current, into: &state)
		#expect(state.listenStatus?.status == "stopping")
		#expect(state.listenStatus?.session?.id == "s1")
		#expect(state.listenStatus?.isLiveCapture == false)
		#expect(state.listenStatus?.isFinalizing == true)
		#expect(state.listenStatus?.outputDir == "/tmp/out")
		#expect(state.recordingProcessing?.stage == .generatingAudio)
		#expect(state.recordingProcessing?.recordingId == "s1")
		#expect(state.activityLine == "Generating final audio…")
		#expect(state.toast?.style == .progress)
	}

	@Test("applyNativeStopFailed keeps processing when native is still finalizing")
	func applyNativeStopFailedKeepsFinalizing() {
		var state = makeState()
		ChatRecordingController.applyNativeStopFailed(
			message: "The request timed out.",
			status: ListenStatusResponse(
				status: "stopping",
				session: ListenSessionInfo(
					id: "s1",
					startedAt: "2026-01-01T00:00:00Z",
					sources: ListenSourceSelection(mic: true, system: false),
				),
				outputDir: "/tmp/out",
				message: "Generating final audio.",
				error: nil,
			),
			into: &state,
		)
		#expect(state.listenStatus?.isFinalizing == true)
		#expect(state.recordingProcessing?.stage == .generatingAudio)
		#expect(state.activityLine == "Generating final audio…")
	}

	@Test("live capture excludes stopping status")
	func liveCaptureExcludesStopping() {
		let stopping = ListenStatusResponse(
			status: "stopping",
			session: ListenSessionInfo(
				id: "s1",
				startedAt: "2026-01-01T00:00:00Z",
				sources: ListenSourceSelection(mic: true, system: false),
			),
			outputDir: nil,
			message: nil,
			error: nil,
		)
		#expect(stopping.isLiveCapture == false)
		#expect(stopping.isActive == false)
		#expect(stopping.isFinalizing == true)
		#expect(ActiveRecordingInfo(stopping) == nil)
	}

	@Test("classifyStopResult routes missing id, errors, and ready")
	func classifyStopResult() {
		let noId = NativeAudioStopResponse(
			status: "idle",
			message: nil,
			id: nil,
			outputDir: nil,
			files: nil,
			errors: ["x"],
		)
		if case .withoutRecordingId(_, let id, let errors) =
			ChatRecordingController.classifyStopResult(noId)
		{
			#expect(id == nil)
			#expect(errors == ["x"])
		} else {
			Issue.record("expected withoutRecordingId")
		}

		let failed = NativeAudioStopResponse(
			status: "idle",
			message: nil,
			id: "r1",
			outputDir: nil,
			files: nil,
			errors: ["  bad  "],
		)
		if case .failedBeforeTranscription(let id, let message, _) =
			ChatRecordingController.classifyStopResult(failed)
		{
			#expect(id == "r1")
			#expect(message == "bad")
		} else {
			Issue.record("expected failedBeforeTranscription")
		}

		let ready = NativeAudioStopResponse(
			status: "idle",
			message: nil,
			id: "r2",
			outputDir: nil,
			files: nil,
			errors: nil,
		)
		if case .readyForTranscription(let id, _) = ChatRecordingController.classifyStopResult(ready) {
			#expect(id == "r2")
		} else {
			Issue.record("expected readyForTranscription")
		}
	}

	@Test("applyStopClassification ready enters preparing transcription")
	func applyReadyForTranscription() {
		var state = makeState()
		let result = NativeAudioStopResponse(
			status: "idle",
			message: "ok",
			id: "r9",
			outputDir: "/tmp",
			files: nil,
			errors: nil,
		)
		let classification = ChatRecordingController.classifyStopResult(result)
		ChatRecordingController.applyStopClassification(classification, into: &state)
		#expect(state.recordingProcessing?.recordingId == "r9")
		#expect(state.recordingProcessing?.stage == .preparingTranscription)
		#expect(state.activityLine == "Transcribing recording…")
	}

	@Test("transcription progress ignored when processing id mismatches")
	func transcriptionProgressGuardsId() {
		var state = makeState()
		state.recordingProcessing = RecordingProcessingState(
			recordingId: "r1",
			stage: .preparingTranscription,
		)
		ChatRecordingController.applyTranscriptionProgress(
			recordingId: "other",
			message: "chunk",
			into: &state,
		)
		#expect(state.recordingProcessing?.stage == .preparingTranscription)
		#expect(state.activityLine == "Ready")
	}

	@Test("transcription complete sets success toast")
	func transcriptionComplete() {
		var state = makeState()
		ChatRecordingController.applyTranscriptionComplete(recordingId: "r1", into: &state)
		#expect(state.recordingProcessing?.stage == .complete)
		#expect(state.toast?.style == .success)
		#expect(state.toast?.action == .openRecording(id: "r1"))
		#expect(state.activityLine == "Recording transcribed")
	}
}
