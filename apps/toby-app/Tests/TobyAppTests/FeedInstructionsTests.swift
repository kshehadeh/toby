import Foundation
import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

private func instruction(_ id: String, _ text: String, enabled: Bool = true) -> FeedInstruction {
	FeedInstruction(id: id, text: text, createdAt: "2026-11-16T15:00:00.000Z", enabled: enabled)
}

/// In-memory stand-in for the daemon's instruction list (oldest first).
@MainActor
private final class FakeInstructions {
	var items: [FeedInstruction] = []
	var failNext = false
	private var nextID = 1

	func remote() -> FeedInstructionsStore.Remote {
		FeedInstructionsStore.Remote(
			list: { [unowned self] in self.items },
			add: { [unowned self] text in
				try self.check()
				self.items.append(instruction("i\(self.nextID)", text))
				self.nextID += 1
				return self.items
			},
			setEnabled: { [unowned self] id, enabled in
				try self.check()
				self.items = self.items.map { $0.id == id ? instruction($0.id, $0.text, enabled: enabled) : $0 }
				return self.items
			},
			delete: { [unowned self] id in
				try self.check()
				self.items.removeAll { $0.id == id }
				return self.items
			}
		)
	}

	private func check() throws {
		if failNext {
			failNext = false
			throw TobyClientError.invalidResponse
		}
	}
}

@MainActor
@Suite("Feed instructions")
struct FeedInstructionsTests {
	@Test("decodes the daemon payload")
	func decodes() throws {
		let json = """
		{"instructions":[{"id":"a","text":"Skip news","createdAt":"2026-11-16T15:00:00.000Z","enabled":false}]}
		"""
		let payload = try JSONDecoder().decode(FeedInstructionsResponse.self, from: Data(json.utf8))
		#expect(payload.instructions == [instruction("a", "Skip news", enabled: false)])
	}

	@Test("decodes enforcement and describes how each instruction is applied")
	func decodesEnforcement() throws {
		let json = """
		{"instructions":[
		{"id":"a","text":"Ignore Todoist outside the Inbox","createdAt":"2026-11-16T15:00:00.000Z","enabled":true,"enforcement":"filter","enforcementSummary":"Hides Todoist tasks outside the Inbox"},
		{"id":"b","text":"Put email first","createdAt":"2026-11-16T15:00:00.000Z","enabled":true,"enforcement":"guidance"},
		{"id":"c","text":"New","createdAt":"2026-11-16T15:00:00.000Z","enabled":true,"enforcement":"pending"}
		]}
		"""
		let items = try JSONDecoder().decode(FeedInstructionsResponse.self, from: Data(json.utf8)).instructions
		#expect(items[0].enforcementCaption == "Always enforced · Hides Todoist tasks outside the Inbox")
		#expect(items[1].enforcementCaption == "Used as ranking guidance")
		#expect(items[2].enforcementCaption == nil)
		#expect(instruction("d", "Old daemon").enforcementCaption == nil)
	}

	@Test("store lists newest first, adds, toggles, deletes, and reports changes once")
	func storeLifecycle() async {
		let fake = FakeInstructions()
		fake.items = [instruction("old", "Hide GitHub notifications")]
		let store = FeedInstructionsStore(remote: fake.remote())

		await store.load()
		#expect(store.instructions.map(\.id) == ["old"])
		#expect(!store.consumeChanges())

		#expect(await store.add("  Put mail from Sam first  "))
		#expect(store.instructions.map(\.text) == ["Put mail from Sam first", "Hide GitHub notifications"])
		#expect(!(await store.add("   ")))

		await store.setEnabled(store.instructions[1], enabled: false)
		#expect(store.enabledCount == 1)

		await store.delete(store.instructions[0])
		#expect(store.instructions.map(\.id) == ["old"])
		#expect(store.consumeChanges())
		#expect(!store.consumeChanges())
	}

	@Test("a failed change keeps the list and shows an error")
	func storeFailure() async {
		let fake = FakeInstructions()
		fake.items = [instruction("a", "Skip news")]
		let store = FeedInstructionsStore(remote: fake.remote())
		await store.load()
		fake.failNext = true
		#expect(!(await store.add("Another")))
		#expect(store.instructions.map(\.id) == ["a"])
		#expect(store.error != nil)
		#expect(!store.consumeChanges())
	}

	@Test("row shows the text and runs toggle and delete")
	func rowActions() throws {
		var toggled: [Bool] = []
		var deleted = false
		let row = FeedInstructionRow(
			instruction: instruction("a", "Skip news"),
			onToggle: { toggled.append($0) },
			onDelete: { deleted = true }
		)
		let inspected = try row.inspect()
		#expect(throws: Never.self) { try inspected.find(text: "Skip news") }
		try inspected.find(ViewType.Toggle.self).tap()
		#expect(toggled == [false])
		try inspected.find(ViewType.Button.self).tap()
		#expect(deleted)
	}
}
