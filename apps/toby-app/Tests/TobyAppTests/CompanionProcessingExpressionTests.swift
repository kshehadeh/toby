import AppKit
import Testing
@testable import TobyApp

@MainActor
@Suite("Companion processing expressions")
struct CompanionProcessingExpressionTests {
	@Test("One eyebrow rises during processing and settles afterward")
	func eyebrowTiming() {
		var state = CompanionEyebrowState()
		state.update(processing: true, reduceMotion: false)
		#expect(state.amount > 0 && state.amount < 1)
		for _ in 0..<30 { state.update(processing: true, reduceMotion: false) }
		#expect(state.amount == 1)
		for _ in 0..<30 { state.update(processing: false, reduceMotion: false) }
		#expect(state.amount == 0)
		state.update(processing: true, reduceMotion: true)
		#expect(state.amount == 1)
		state.update(processing: false, reduceMotion: true)
		#expect(state.amount == 0)
	}

	@Test("Talking follows text delivery, pauses during gaps, and stops at completion")
	func speechTiming() {
		var state = CompanionMouthState()
		state.update(conversationVisible: true, now: 10, reduceMotion: false, streamingText: "Hello")
		state.update(conversationVisible: true, now: 10.15, reduceMotion: false, streamingText: "Hello")
		#expect(state.openness > 0.9)
		state.update(conversationVisible: true, now: 10.5, reduceMotion: false, streamingText: "Hello")
		#expect(state.openness == 0)
		state.update(conversationVisible: true, now: 11, reduceMotion: false, streamingText: "Hello there")
		state.update(conversationVisible: true, now: 11.15, reduceMotion: false, streamingText: "Hello there")
		#expect(state.openness > 0.9)
		state.update(conversationVisible: true, now: 11.2, reduceMotion: false)
		#expect(state.openness == 0)
		for _ in 0..<30 { state.update(conversationVisible: true, now: 12, reduceMotion: false) }
		#expect(state.amount == 1)
	}

	@Test("Closing, hiding, and Reduce Motion stop talking and preserve existing expressions")
	func speechVisibility() {
		let view = CompanionPortraitView(frame: NSRect(origin: .zero, size: CompanionGeometry.faceSize))
		view.updateMouth(conversationVisible: true, now: 10, reduceMotion: false, streamingText: "Hello")
		view.updateMouth(conversationVisible: true, now: 10.15, reduceMotion: false, streamingText: "Hello")
		#expect(view.mouth.openness > 0)
		view.updateMouth(conversationVisible: true, now: 10.2, reduceMotion: true, streamingText: "Hello")
		#expect(view.mouth.openness == 0 && view.mouth.amount == 1)
		view.updateMouth(conversationVisible: false, now: 11, reduceMotion: true, streamingText: "Hello")
		#expect(view.mouth.openness == 0 && view.mouth.amount == -1)
		view.updateEyebrows(processing: true, reduceMotion: true)
		view.resetExpressions()
		#expect(view.mouth.amount == 0 && view.mouth.openness == 0 && view.eyebrows.amount == 0)
	}

	@Test("Assistant text drives talking regardless of transcript placement; waiting stops it")
	func streamSelection() throws {
		let store = CompanionStore()
		#expect(!store.isProcessingResponse && store.speakingText == nil)
		store.chat.isLoading = true
		#expect(store.isProcessingResponse && store.speakingText == nil)
		store.chat.transcript = [.meta(text: "Preparing"), .toolOutput(blockKey: "tool", detail: "Result", toolName: "search")]
		#expect(store.speakingText == nil)
		var turn = ChatTurnMutationState(transcript: [], streamingAssistant: nil, activityLine: "",
			assistantHeader: "Toby", assistantBuffer: "", sawToolCallThisTurn: false, personaFallback: "Toby")
		let event = try JSONDecoder().decode(ChatEventPayload.self,
			from: Data(#"{"type":"assistant_text_delta","delta":"Hello"}"#.utf8))
		ChatTurnEngine.apply(event: event, state: &turn)
		store.chat.streamingAssistant = turn.streamingAssistant
		#expect(store.chat.streamingAssistant?.inWorkArea == true)
		#expect(store.speakingText == "Hello")
		store.chat.streamingAssistant = StreamingAssistantState(header: "Toby", text: "Hello", inWorkArea: false)
		#expect(store.speakingText == "Hello")
		store.chat.activeAskUserPrompt = ActiveAskUserPrompt(id: "ask", turnId: "turn", requestId: "ask",
			query: "Which one?", options: ["First"])
		#expect(!store.isProcessingResponse && store.speakingText == nil)
		store.chat.activeAskUserPrompt = nil
		store.chat.isLoading = false
		#expect(!store.isProcessingResponse && store.speakingText == nil)
	}

	@Test("Thinking and talking render distinct layers and restore the idle portrait")
	func rendering() throws {
		let view = CompanionPortraitView(frame: NSRect(x: 0, y: 0, width: 310, height: 312))
		func snapshot(_ name: String) throws -> Data {
			let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
			view.cacheDisplay(in: view.bounds, to: bitmap)
			let data = try #require(bitmap.representation(using: .png, properties: [:]))
			if let directory = ProcessInfo.processInfo.environment["TOBY_COMPANION_RENDER_DIR"] {
				try data.write(to: URL(fileURLWithPath: directory).appendingPathComponent("processing-\(name).png"))
			}
			return data
		}
		let idle = try snapshot("idle")
		view.updateEyebrows(processing: true, reduceMotion: true)
		let thinking = try snapshot("thinking")
		view.updateMouth(conversationVisible: true, now: 10, reduceMotion: false, streamingText: "Hello")
		view.updateMouth(conversationVisible: true, now: 10.15, reduceMotion: false, streamingText: "Hello")
		let talking = try snapshot("talking")
		#expect(idle != thinking && thinking != talking)
		view.resetExpressions()
		#expect(try snapshot("restored") == idle)
	}
}
