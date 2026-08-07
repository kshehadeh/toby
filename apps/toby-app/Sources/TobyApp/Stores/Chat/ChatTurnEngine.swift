import Foundation

/// Mutable slice of chat state that SSE turn events rewrite during a stream.
/// Kept free of networking so `apply` can be unit-tested without a daemon.
struct ChatTurnMutationState: Equatable {
	var transcript: [TranscriptEntry]
	var streamingAssistant: StreamingAssistantState?
	var activityLine: String
	var assistantHeader: String
	var assistantBuffer: String
	var sawToolCallThisTurn: Bool
	/// Fallback assistant header when the event omits one (`status?.persona`).
	var personaFallback: String
}

/// Pure-ish turn event applier and transcript row mutators for chat streaming.
/// Call sites on `ChatStore` mirror state into/out of `ChatTurnMutationState`.
@MainActor
enum ChatTurnEngine {
	static func apply(event: ChatEventPayload, state: inout ChatTurnMutationState) {
		switch event.type {
		case "lifecycle_start":
			appendProcessingRow(
				id: event.id ?? UUID().uuidString,
				header: event.header ?? "Working",
				body: "Thinking",
				variant: "lifecycle",
				state: &state,
			)
			if let header = event.header {
				state.activityLine = header
			}
		case "lifecycle_end":
			updateProcessingRow(
				id: event.id,
				body: event.detail ?? "Done.",
				state: &state,
			)
		case "lifecycle_append":
			appendProcessingDetail(id: event.id, line: event.line, state: &state)
		case "lifecycle_set":
			updateProcessingRow(id: event.id, body: event.line ?? "", state: &state)
		case "assistant_segment_start":
			state.assistantHeader = event.header ?? state.personaFallback
			state.assistantBuffer = ""
			state.streamingAssistant = StreamingAssistantState(
				header: state.assistantHeader,
				text: "",
				inWorkArea: !state.sawToolCallThisTurn,
			)
			state.activityLine = "Responding…"
		case "assistant_text_delta":
			state.assistantBuffer += event.delta ?? ""
			state.streamingAssistant = StreamingAssistantState(
				header: state.assistantHeader,
				text: state.assistantBuffer,
				inWorkArea: !state.sawToolCallThisTurn,
			)
		case "assistant_segment_end":
			commitAssistantSegment(
				id: event.id ?? UUID().uuidString,
				interim: event.interim == true,
				state: &state,
			)
		case "tool_call_start":
			// askUser is rendered as an inline transcript control, not a tool step.
			if event.toolName == "askUser" {
				state.activityLine = "Waiting for your choice…"
				break
			}
			state.sawToolCallThisTurn = true
			if let toolName = event.toolName {
				let args = event.args?.value as? [String: Any]
				let header = ToolDisplayLabels.formatToolCallHeader(
					toolName: toolName,
					args: args,
					integrationLabel: event.integrationLabel,
				)
				appendToolRow(
					id: event.blockKey ?? event.id ?? UUID().uuidString,
					header: header,
					body: "Running…",
					toolName: toolName,
					integrationLabel: event.integrationLabel,
					cacheHit: nil,
					durationMs: nil,
					state: &state,
				)
				state.activityLine = "Running \(ToolDisplayLabels.displayLabel(toolName))…"
			}
		case "tool_call_complete":
			if event.toolName == "askUser" {
				appendAskUserQA(from: event, state: &state)
				state.activityLine = "Thinking…"
				break
			}
			if let toolName = event.toolName {
				let args = event.args?.value as? [String: Any]
				let errorString = errorString(from: event.error?.value)
				let body: String
				if event.cacheHit == true {
					body = "Done. Cached result."
				} else {
					body = ToolDisplayLabels.formatToolOutput(
						toolName: toolName,
						args: args,
						result: event.result?.value,
						error: errorString,
					)
				}
				let fullBody: String?
				if event.cacheHit == true {
					fullBody = nil
				} else {
					let full = ToolDisplayLabels.formatToolOutputFull(
						toolName: toolName,
						args: args,
						result: event.result?.value,
						error: errorString,
					)
					fullBody = full != body ? full : nil
				}
				let header = ToolDisplayLabels.formatToolCallHeader(
					toolName: toolName,
					args: args,
					integrationLabel: event.integrationLabel,
				)
				upsertToolRow(
					id: event.blockKey ?? event.id ?? UUID().uuidString,
					header: header,
					body: body,
					fullBody: fullBody,
					toolName: toolName,
					integrationLabel: event.integrationLabel,
					cacheHit: event.cacheHit,
					durationMs: event.durationMs,
					state: &state,
				)
				// Notify memories UI when chat mutates durable memory.
				if errorString == nil, MemoriesStore.mutatingMemoryTools.contains(toolName) {
					NotificationCenter.default.post(name: .memoriesDidChange, object: nil)
				}
			}
			state.activityLine = "Thinking…"
		case "prep_start":
			appendProcessingRow(
				id: event.id ?? UUID().uuidString,
				header: event.header ?? "Prompt preparation",
				body: "",
				variant: "prep",
				state: &state,
			)
			if let header = event.header {
				state.activityLine = header
			}
		case "prep_end":
			updateProcessingRow(
				id: event.id,
				body: event.detail ?? "Request prepared.",
				state: &state,
			)
			state.activityLine = "Ready for model…"
		case "transcript_notice":
			if let text = event.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
				state.transcript.append(.notice(text: text, tone: event.tone))
			}
		default:
			break
		}
	}

	static func commitAssistantSegment(
		id: String,
		interim: Bool,
		state: inout ChatTurnMutationState,
	) {
		let body = state.assistantBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !body.isEmpty else { return }
		state.transcript.append(
			.boxedStep(
				BoxedStepPayload(
					id: id,
					seq: state.transcript.count + 1,
					variant: interim ? "assistant_interim" : "assistant",
					header: state.assistantHeader,
					body: body,
					toolName: nil,
					integrationLabel: nil,
					cacheHit: nil,
					durationMs: nil,
					toolRuns: nil,
					fullBody: nil,
				),
			),
		)
		state.assistantBuffer = ""
		state.streamingAssistant = nil
	}

	static func hasAssistantReplyBody(
		_ body: String,
		sinceIndex userIndex: Int,
		in transcript: [TranscriptEntry],
	) -> Bool {
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

	// MARK: - Row mutators

	static func appendProcessingRow(
		id: String,
		header: String,
		body: String,
		variant: String,
		state: inout ChatTurnMutationState,
	) {
		state.transcript.append(
			.boxedStep(
				BoxedStepPayload(
					id: id,
					seq: state.transcript.count + 1,
					variant: variant,
					header: header,
					body: body,
					toolName: nil,
					integrationLabel: nil,
					cacheHit: nil,
					durationMs: nil,
					toolRuns: nil,
					fullBody: nil,
				),
			),
		)
	}

	static func updateProcessingRow(
		id: String?,
		body: String,
		state: inout ChatTurnMutationState,
	) {
		guard let id else { return }
		replaceBoxedStep(id: id, state: &state) { current in
			BoxedStepPayload(
				id: current.id,
				seq: current.seq,
				variant: current.variant,
				header: current.header,
				body: body,
				toolName: current.toolName,
				integrationLabel: current.integrationLabel,
				cacheHit: current.cacheHit,
				durationMs: current.durationMs,
				toolRuns: current.toolRuns,
				fullBody: current.fullBody,
			)
		}
	}

	static func appendProcessingDetail(
		id: String?,
		line: String?,
		state: inout ChatTurnMutationState,
	) {
		guard let id, let line, !line.isEmpty else { return }
		replaceBoxedStep(id: id, state: &state) { current in
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
				durationMs: current.durationMs,
				toolRuns: current.toolRuns,
				fullBody: current.fullBody,
			)
		}
	}

	static func appendToolRow(
		id: String,
		header: String,
		body: String,
		fullBody: String? = nil,
		toolName: String,
		integrationLabel: String?,
		cacheHit: Bool?,
		durationMs: Int?,
		state: inout ChatTurnMutationState,
	) {
		state.transcript.append(
			.boxedStep(
				BoxedStepPayload(
					id: id,
					seq: state.transcript.count + 1,
					variant: "tool",
					header: header,
					body: body,
					toolName: toolName,
					integrationLabel: integrationLabel,
					cacheHit: cacheHit,
					durationMs: durationMs,
					toolRuns: nil,
					fullBody: fullBody,
				),
			),
		)
	}

	/// Server-side askUser tool completion. Prefer upgrading a local optimistic
	/// Q&A row when one was already inserted on submit, so the control does not
	/// flash empty and then double-render.
	static func appendAskUserQA(from event: ChatEventPayload, state: inout ChatTurnMutationState) {
		let args = event.args?.value as? [String: Any]
		var query = (args?["query"] as? String) ?? ""
		let blockKey = event.blockKey ?? event.id ?? UUID().uuidString

		let errorString = errorString(from: event.error?.value)

		let answer: String
		let resolvedError: String?
		if let errorString, !errorString.isEmpty {
			answer = ""
			resolvedError = errorString
		} else if let result = event.result?.value as? [String: Any],
			let resultError = result["error"] as? String,
			!resultError.isEmpty
		{
			answer = ""
			resolvedError = resultError
		} else {
			let result = event.result?.value as? [String: Any]
			answer = ((result?["selectedLabel"] as? String) ?? "")
				.trimmingCharacters(in: .whitespacesAndNewlines)
			resolvedError = nil
		}

		if let index = state.transcript.lastIndex(where: { entry in
			if case .askUserQA(let key, let existingQuery, _, _) = entry {
				return existingQuery == query || key.hasPrefix("local-ask-")
			}
			return false
		}) {
			if query.isEmpty, case .askUserQA(_, let existingQuery, _, _) = state.transcript[index] {
				query = existingQuery
			}
			state.transcript[index] = .askUserQA(
				blockKey: blockKey,
				query: query,
				answer: answer,
				error: resolvedError,
			)
			return
		}

		state.transcript.append(
			.askUserQA(blockKey: blockKey, query: query, answer: answer, error: resolvedError),
		)
	}

	static func upsertToolRow(
		id: String,
		header: String,
		body: String,
		fullBody: String? = nil,
		toolName: String,
		integrationLabel: String?,
		cacheHit: Bool?,
		durationMs: Int?,
		state: inout ChatTurnMutationState,
	) {
		let replaced = replaceBoxedStep(id: id, state: &state) { current in
			BoxedStepPayload(
				id: current.id,
				seq: current.seq,
				variant: "tool",
				header: header,
				body: body,
				toolName: toolName,
				integrationLabel: integrationLabel,
				cacheHit: cacheHit,
				durationMs: durationMs,
				toolRuns: nil,
				fullBody: fullBody,
			)
		}
		if !replaced {
			appendToolRow(
				id: id,
				header: header,
				body: body,
				fullBody: fullBody,
				toolName: toolName,
				integrationLabel: integrationLabel,
				cacheHit: cacheHit,
				durationMs: durationMs,
				state: &state,
			)
		}
	}

	@discardableResult
	static func replaceBoxedStep(
		id: String,
		state: inout ChatTurnMutationState,
		transform: (BoxedStepPayload) -> BoxedStepPayload,
	) -> Bool {
		guard let index = state.transcript.lastIndex(where: { entry in
			if case .boxedStep(let payload) = entry {
				return payload.id == id
			}
			return false
		}) else {
			return false
		}
		if case .boxedStep(let payload) = state.transcript[index] {
			state.transcript[index] = .boxedStep(transform(payload))
			return true
		}
		return false
	}

	// MARK: - Helpers

	private static func errorString(from value: Any?) -> String? {
		guard let value else { return nil }
		if value is NSNull {
			return nil
		}
		if let str = value as? String {
			return str
		}
		return String(describing: value)
	}
}
