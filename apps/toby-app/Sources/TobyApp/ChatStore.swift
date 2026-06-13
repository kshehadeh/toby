import Foundation
import Observation

@Observable
@MainActor
final class ChatStore {
	var status: AppStatus?
	var sessionId: String?
	var sessionName: String = "New chat"
	var transcript: [TranscriptEntry] = []
	var streamingAssistant: StreamingAssistantState?
	var activityLine: String = "Connecting…"
	var promptText: String = ""
	var isLoading = false
	var errorMessage: String?
	let serverEventLogPath = ServerEventLog.path

	private let client = TobyClient()
	private var assistantHeader = ""
	private var assistantBuffer = ""

	func bootstrap() async {
		do {
			status = try await client.fetchStatus()
			let created = try await client.createSession()
			sessionId = created.id
			sessionName = created.name
			activityLine = "Ready"
			errorMessage = nil
		} catch {
			errorMessage = error.localizedDescription
			activityLine = "Daemon unavailable"
		}
	}

	func startNewSession() async {
		guard !isLoading else { return }
		do {
			let created = try await client.createSession()
			sessionId = created.id
			sessionName = created.name
			transcript = []
			streamingAssistant = nil
			errorMessage = nil
			activityLine = "Ready"
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func submitPrompt() async {
		let text = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !text.isEmpty, !isLoading, let sessionId else { return }

		promptText = ""
		transcript.append(.user(text: text))
		let userTurnStartIndex = transcript.count - 1
		isLoading = true
		activityLine = "Thinking…"
		streamingAssistant = nil
		assistantHeader = ""
		assistantBuffer = ""
		errorMessage = nil

		do {
			let done = try await client.streamTurn(sessionId: sessionId, text: text) { event in
				self.apply(event: event)
			}
			if !assistantBuffer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				commitAssistantSegment(id: UUID().uuidString)
			}
			let reply = done.text.trimmingCharacters(in: .whitespacesAndNewlines)
			if !reply.isEmpty && !hasAssistantReplyBody(reply, sinceIndex: userTurnStartIndex) {
				assistantHeader = status?.persona ?? "Assistant"
				assistantBuffer = reply
				commitAssistantSegment(id: UUID().uuidString)
			}
			if let nextSessionName = done.sessionName?.trimmingCharacters(
				in: .whitespacesAndNewlines,
			), !nextSessionName.isEmpty {
				sessionName = nextSessionName
			}
			streamingAssistant = nil
			activityLine = "Ready"
		} catch {
			errorMessage = error.localizedDescription
			transcript.append(.error(text: error.localizedDescription))
			activityLine = "Error"
		}

		isLoading = false
	}

	private func apply(event: ChatEventPayload) {
		switch event.type {
		case "lifecycle_start":
			appendProcessingRow(
				id: event.id ?? UUID().uuidString,
				header: event.header ?? "Working",
				body: "Thinking",
				variant: "lifecycle",
			)
			if let header = event.header {
				activityLine = header
			}
		case "lifecycle_end":
			updateProcessingRow(
				id: event.id,
				body: event.detail ?? "Done.",
			)
		case "lifecycle_append":
			appendProcessingDetail(id: event.id, line: event.line)
		case "lifecycle_set":
			updateProcessingRow(id: event.id, body: event.line ?? "")
		case "assistant_segment_start":
			assistantHeader = event.header ?? status?.persona ?? "Assistant"
			assistantBuffer = ""
			streamingAssistant = StreamingAssistantState(header: assistantHeader, text: "")
			activityLine = "Responding…"
		case "assistant_text_delta":
			assistantBuffer += event.delta ?? ""
			streamingAssistant = StreamingAssistantState(
				header: assistantHeader,
				text: assistantBuffer,
			)
		case "assistant_segment_end":
			commitAssistantSegment(id: event.id ?? UUID().uuidString)
		case "tool_call_start":
			if let toolName = event.toolName {
				appendToolRow(
					id: event.blockKey ?? event.id ?? UUID().uuidString,
					header: event.integrationLabel.map { "\($0): \(toolName)" } ?? toolName,
					body: "Running…",
					toolName: toolName,
					integrationLabel: event.integrationLabel,
					cacheHit: nil,
				)
				activityLine = "Running \(toolName)…"
			}
		case "tool_call_complete":
			if let toolName = event.toolName {
				upsertToolRow(
					id: event.blockKey ?? event.id ?? UUID().uuidString,
					header: event.integrationLabel.map { "\($0): \(toolName)" } ?? toolName,
					body: event.cacheHit == true ? "Done. Cached result." : "Done.",
					toolName: toolName,
					integrationLabel: event.integrationLabel,
					cacheHit: event.cacheHit,
				)
			}
			activityLine = "Thinking…"
		case "prep_start":
			if let header = event.header {
				activityLine = header
			}
		default:
			break
		}
	}

	private func appendProcessingRow(
		id: String,
		header: String,
		body: String,
		variant: String,
	) {
		transcript.append(
			.boxedStep(
				BoxedStepPayload(
					id: id,
					seq: transcript.count + 1,
					variant: variant,
					header: header,
					body: body,
					toolName: nil,
					integrationLabel: nil,
					cacheHit: nil,
				),
			),
		)
	}

	private func updateProcessingRow(id: String?, body: String) {
		guard let id else { return }
		replaceBoxedStep(id: id) { current in
			BoxedStepPayload(
				id: current.id,
				seq: current.seq,
				variant: current.variant,
				header: current.header,
				body: body,
				toolName: current.toolName,
				integrationLabel: current.integrationLabel,
				cacheHit: current.cacheHit,
			)
		}
	}

	private func appendProcessingDetail(id: String?, line: String?) {
		guard let id, let line, !line.isEmpty else { return }
		replaceBoxedStep(id: id) { current in
			let nextBody = current.body.isEmpty ? line : "\(current.body)\n\(line)"
			return BoxedStepPayload(
				id: current.id,
				seq: current.seq,
				variant: current.variant,
				header: current.header,
				body: nextBody,
				toolName: current.toolName,
				integrationLabel: current.integrationLabel,
				cacheHit: current.cacheHit,
			)
		}
	}

	private func appendToolRow(
		id: String,
		header: String,
		body: String,
		toolName: String,
		integrationLabel: String?,
		cacheHit: Bool?,
	) {
		transcript.append(
			.boxedStep(
				BoxedStepPayload(
					id: id,
					seq: transcript.count + 1,
					variant: "tool",
					header: header,
					body: body,
					toolName: toolName,
					integrationLabel: integrationLabel,
					cacheHit: cacheHit,
				),
			),
		)
	}

	private func upsertToolRow(
		id: String,
		header: String,
		body: String,
		toolName: String,
		integrationLabel: String?,
		cacheHit: Bool?,
	) {
		let replaced = replaceBoxedStep(id: id) { current in
			BoxedStepPayload(
				id: current.id,
				seq: current.seq,
				variant: "tool",
				header: header,
				body: body,
				toolName: toolName,
				integrationLabel: integrationLabel,
				cacheHit: cacheHit,
			)
		}
		if !replaced {
			appendToolRow(
				id: id,
				header: header,
				body: body,
				toolName: toolName,
				integrationLabel: integrationLabel,
				cacheHit: cacheHit,
			)
		}
	}

	@discardableResult
	private func replaceBoxedStep(
		id: String,
		transform: (BoxedStepPayload) -> BoxedStepPayload,
	) -> Bool {
		guard let index = transcript.lastIndex(where: { entry in
			if case .boxedStep(let payload) = entry {
				return payload.id == id
			}
			return false
		}) else {
			return false
		}
		if case .boxedStep(let payload) = transcript[index] {
			transcript[index] = .boxedStep(transform(payload))
			return true
		}
		return false
	}

	private func commitAssistantSegment(id: String) {
		let body = assistantBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !body.isEmpty else { return }
		transcript.append(
			.boxedStep(
				BoxedStepPayload(
					id: id,
					seq: transcript.count + 1,
					variant: "assistant",
					header: assistantHeader,
					body: body,
					toolName: nil,
					integrationLabel: nil,
					cacheHit: nil,
				),
			),
		)
		assistantBuffer = ""
		streamingAssistant = nil
	}

	private func hasAssistantReplyBody(_ body: String, sinceIndex userIndex: Int) -> Bool {
		guard userIndex >= 0, userIndex < transcript.count else { return false }
		let normalized = body.trimmingCharacters(in: .whitespacesAndNewlines)
		for entry in transcript[(userIndex + 1)...] {
			if case .boxedStep(let payload) = entry, payload.variant == "assistant" {
				if payload.body.trimmingCharacters(in: .whitespacesAndNewlines) == normalized {
					return true
				}
			}
			if case .assistant(let text) = entry {
				if text.trimmingCharacters(in: .whitespacesAndNewlines) == normalized {
					return true
				}
			}
		}
		return false
	}
}
