import Foundation

/// Mutable recording-related UI slice shared with chat (toast / activity line).
struct ChatRecordingUIState {
	var listenStatus: ListenStatusResponse?
	var recordingProcessing: RecordingProcessingState?
	var toast: AppToastState?
	var activityLine: String
}

/// Pure-ish recording lifecycle transitions for ChatStore (start / stop / transcribe UI).
/// Networking stays on the store; this type owns toasts, stages, and activity lines.
@MainActor
enum ChatRecordingController {
	// MARK: - Toasts

	static func unconfiguredTranscriptionToast() -> AppToastState {
		AppToastState(
			style: .error,
			title: "No transcription model configured",
			message:
				"Audio will be saved without a transcript. Choose a transcription provider to enable transcripts.",
			action: .openSettings(navKey: "transcription"),
		)
	}

	static func recordingFailedToast(message: String) -> AppToastState {
		AppToastState(
			style: .error,
			title: "Recording failed",
			message: message,
		)
	}

	/// Success or first-error toast when stop returns without entering the full processing pipeline.
	static func completionToast(recordingId: String?, errors: [String]?) -> AppToastState {
		let message = errors?.first?.trimmingCharacters(in: .whitespacesAndNewlines)
		if let message, !message.isEmpty {
			return AppToastState(
				style: .error,
				title: "Recording issue",
				message: message,
			)
		}
		let action: AppToastAction? = recordingId.map { .openRecording(id: $0) }
		return AppToastState(
			style: .success,
			title: "Recording transcribed",
			message: "Your recording is ready.",
			action: action,
		)
	}

	// MARK: - Start

	static func applyStartSuccess(
		status: ListenStatusResponse,
		into state: inout ChatRecordingUIState,
	) {
		state.listenStatus = status
		state.activityLine = "Recording audio"
	}

	static func applyStartFailure(
		message: String,
		status: ListenStatusResponse?,
		into state: inout ChatRecordingUIState,
	) {
		state.toast = recordingFailedToast(message: message)
		state.activityLine = "Error"
		state.listenStatus = status
	}

	// MARK: - Stop

	/// Immediate UI when the user hits stop — drop live-capture chrome before native stop returns.
	static func applyStoppingCapture(
		current: ListenStatusResponse?,
		into state: inout ChatRecordingUIState,
	) {
		state.listenStatus = ListenStatusResponse(
			status: "stopping",
			session: current?.session,
			outputDir: current?.outputDir,
			message: "Generating final audio…",
			error: nil,
		)
		state.recordingProcessing = RecordingProcessingState(
			recordingId: current?.session?.id,
			stage: .generatingAudio,
		)
		state.toast = state.recordingProcessing?.toastState()
		state.activityLine = "Generating final audio…"
	}

	enum StopClassification {
		/// No saved recording id (still toast completion / errors).
		case withoutRecordingId(status: ListenStatusResponse, id: String?, errors: [String]?)
		/// Saved with a fatal-ish error list — skip transcription.
		case failedBeforeTranscription(id: String, message: String, status: ListenStatusResponse)
		/// Ready to stream transcription.
		case readyForTranscription(id: String, status: ListenStatusResponse)
	}

	static func classifyStopResult(_ result: NativeAudioStopResponse) -> StopClassification {
		let status = result.asStatus
		guard let id = result.id else {
			return .withoutRecordingId(status: status, id: result.id, errors: result.errors)
		}
		if let errors = result.errors,
			let firstError = errors.first?.trimmingCharacters(in: .whitespacesAndNewlines),
			!firstError.isEmpty
		{
			return .failedBeforeTranscription(id: id, message: firstError, status: status)
		}
		return .readyForTranscription(id: id, status: status)
	}

	static func applyStopClassification(
		_ classification: StopClassification,
		into state: inout ChatRecordingUIState,
	) {
		switch classification {
		case .withoutRecordingId(let status, let id, let errors):
			state.listenStatus = status
			state.activityLine = "Recording saved"
			state.toast = completionToast(recordingId: id, errors: errors)
			state.recordingProcessing = nil
		case .failedBeforeTranscription(let id, let message, let status):
			state.listenStatus = status
			state.recordingProcessing = RecordingProcessingState(
				recordingId: id,
				stage: .failed,
				message: message,
			)
			state.toast = state.recordingProcessing?.toastState()
			state.activityLine = "Recording saved"
		case .readyForTranscription(let id, let status):
			state.listenStatus = status
			state.recordingProcessing = RecordingProcessingState(
				recordingId: id,
				stage: .preparingTranscription,
			)
			state.toast = state.recordingProcessing?.toastState()
			state.activityLine = "Transcribing recording…"
		}
	}

	static func applyTranscriptionProgress(
		recordingId: String,
		message: String,
		into state: inout ChatRecordingUIState,
	) {
		guard state.recordingProcessing?.recordingId == recordingId,
			state.recordingProcessing?.isActive == true
		else { return }
		state.recordingProcessing?.stage = .transcribing
		state.recordingProcessing?.message = message
		state.toast = state.recordingProcessing?.toastState()
		state.activityLine = message
	}

	static func applyTranscriptionComplete(
		recordingId: String,
		into state: inout ChatRecordingUIState,
	) {
		state.recordingProcessing = RecordingProcessingState(
			recordingId: recordingId,
			stage: .complete,
			message: "Your recording is ready.",
		)
		state.toast = state.recordingProcessing?.toastState()
		state.activityLine = "Recording transcribed"
	}

	static func applyTranscriptionFailed(
		recordingId: String,
		errorDescription: String,
		into state: inout ChatRecordingUIState,
	) {
		state.recordingProcessing = RecordingProcessingState(
			recordingId: recordingId,
			stage: .failed,
			message: "Recording saved, but transcription failed: \(errorDescription)",
		)
		state.toast = state.recordingProcessing?.toastState()
		state.activityLine = "Recording saved"
	}

	static func applyNativeStopFailed(
		message: String,
		status: ListenStatusResponse?,
		into state: inout ChatRecordingUIState,
	) {
		state.toast = recordingFailedToast(message: message)
		if let status, status.isFinalizing {
			state.listenStatus = status
			if state.recordingProcessing?.isActive != true {
				state.recordingProcessing = RecordingProcessingState(
					recordingId: status.session?.id,
					stage: .generatingAudio,
				)
			}
			state.activityLine = "Generating final audio…"
			return
		}
		state.activityLine = "Error"
		state.listenStatus = status
		state.recordingProcessing = nil
	}
}
