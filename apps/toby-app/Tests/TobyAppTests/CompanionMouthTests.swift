import AppKit
import Foundation
import Testing
@testable import TobyApp

@MainActor
@Suite("Companion mouth expressions")
struct CompanionMouthTests {
	@Test("Idle stays neutral; closing smiles triggers a two-second frown")
	func timing() {
		var state = CompanionMouthState()
		state.update(conversationVisible: false, now: 10, reduceMotion: true)
		#expect(state.amount == 0)
		state.update(conversationVisible: true, now: 11, reduceMotion: true)
		#expect(state.amount == 1)
		state.update(conversationVisible: false, now: 12, reduceMotion: true)
		#expect(state.amount == -1)
		state.update(conversationVisible: false, now: 13.99, reduceMotion: true)
		#expect(state.amount == -1)
		state.update(conversationVisible: false, now: 14, reduceMotion: true)
		#expect(state.amount == 0)
	}

	@Test("Reopening cancels the frown deadline and repeated close doesn't extend it")
	func reopening() {
		var state = CompanionMouthState()
		state.update(conversationVisible: true, now: 10, reduceMotion: true)
		state.update(conversationVisible: false, now: 11, reduceMotion: true)
		state.update(conversationVisible: true, now: 12, reduceMotion: true)
		state.update(conversationVisible: true, now: 14, reduceMotion: true)
		#expect(state.amount == 1)
		state.update(conversationVisible: false, now: 15, reduceMotion: true)
		state.update(conversationVisible: false, now: 16, reduceMotion: true)
		state.update(conversationVisible: false, now: 17, reduceMotion: true)
		#expect(state.amount == 0)
	}

	@Test("Animated transitions settle without overshoot and hiding resets expression")
	func settling() {
		let view = CompanionPortraitView(frame: NSRect(origin: .zero, size: CompanionGeometry.faceSize))
		view.updateMouth(conversationVisible: true, now: 10, reduceMotion: false)
		#expect(view.mouth.amount > 0 && view.mouth.amount < 1)
		for step in 1...30 {
			view.updateMouth(conversationVisible: true, now: 10 + Double(step) / 30, reduceMotion: false)
			#expect(view.mouth.amount <= 1)
		}
		#expect(view.mouth.amount == 1)
		view.updateMouth(conversationVisible: false, now: 11.1, reduceMotion: false)
		for step in 1...30 {
			view.updateMouth(conversationVisible: false, now: 11.1 + Double(step) / 30, reduceMotion: false)
			#expect(view.mouth.amount >= -1)
		}
		#expect(view.mouth.amount == -1)
		for step in 0...30 {
			view.updateMouth(conversationVisible: false, now: 13.1 + Double(step) / 30, reduceMotion: false)
		}
		#expect(view.mouth.amount == 0)
		view.updateMouth(conversationVisible: true, now: 15, reduceMotion: true)
		view.resetExpressions()
		#expect(view.mouth.amount == 0 && !view.mouth.conversationVisible)
	}

	@Test("Neutral, smile, and frown produce distinct rendered mouth layers")
	func rendering() throws {
		let view = CompanionPortraitView(frame: NSRect(origin: .zero, size: CompanionGeometry.faceSize))
		func snapshot(_ name: String) throws -> Data {
			let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
			view.cacheDisplay(in: view.bounds, to: bitmap)
			let data = try #require(bitmap.representation(using: .png, properties: [:]))
			if let directory = ProcessInfo.processInfo.environment["TOBY_COMPANION_RENDER_DIR"] {
				try data.write(to: URL(fileURLWithPath: directory).appendingPathComponent("mouth-\(name).png"))
			}
			return data
		}
		let neutral = try snapshot("neutral")
		view.updateMouth(conversationVisible: true, now: 10, reduceMotion: true)
		let smile = try snapshot("smile")
		view.updateMouth(conversationVisible: false, now: 11, reduceMotion: true)
		let frown = try snapshot("frown")
		#expect(neutral != smile && neutral != frown && smile != frown)
		view.updateMouth(conversationVisible: false, now: 13, reduceMotion: true)
		#expect(try snapshot("restored") == neutral)
	}
}
