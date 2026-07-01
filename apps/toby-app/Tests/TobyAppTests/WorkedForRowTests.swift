import Testing
import SwiftUI
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("WorkedForRow")
struct WorkedForRowTests {

	@Test("WorkStepRow is a button when it has a body")
	func workStepRowWithBodyIsAButton() throws {
		let step = WorkStep(
			id: "tool-1",
			type: .tool,
			title: "Search memory",
			body: "Found 3 item(s).",
			fullBody: nil,
			durationMs: 1500,
			isActive: false,
			cacheHit: false,
			toolName: "memorySearch",
			count: 1,
			children: []
		)
		let view = WorkStepRow(step: step)
		let button = try view.inspect().find(ViewType.Button.self)
		#expect(try button.find(text: "Search memory").string() == "Search memory")
	}

	@Test("WorkStepRow is not a button when it has no body and no children")
	func workStepRowWithoutBodyIsNotAButton() throws {
		let step = WorkStep(
			id: "tool-1",
			type: .tool,
			title: "Search memory",
			body: "",
			fullBody: nil,
			durationMs: nil,
			isActive: false,
			cacheHit: nil,
			toolName: "memorySearch",
			count: 1,
			children: []
		)
		let view = WorkStepRow(step: step)
		#expect(throws: (any Error).self) {
			try view.inspect().find(ViewType.Button.self)
		}
	}

	@Test("aggregate WorkStepRow shows count badge")
	func aggregateWorkStepRowShowsCount() throws {
		let step = WorkStep(
			id: "tool-1",
			type: .tool,
			title: "List reminder lists",
			body: "",
			fullBody: nil,
			durationMs: nil,
			isActive: false,
			cacheHit: nil,
			toolName: "listReminderLists",
			count: 2,
			children: [
				WorkStep(
					id: "a",
					type: .tool,
					title: "List reminder lists",
					body: "Done 1.",
					fullBody: nil,
					durationMs: nil,
					isActive: false,
					cacheHit: nil,
					toolName: "listReminderLists",
					count: 1,
					children: []
				),
				WorkStep(
					id: "b",
					type: .tool,
					title: "List reminder lists",
					body: "Done 2.",
					fullBody: nil,
					durationMs: nil,
					isActive: false,
					cacheHit: nil,
					toolName: "listReminderLists",
					count: 1,
					children: []
				),
			]
		)
		let view = WorkStepRow(step: step)
		#expect(try view.inspect().find(text: "×2").string() == "×2")
	}

	@Test("WorkStepExpandedBody renders children")
	func workStepExpandedBodyRendersChildren() throws {
		let step = WorkStep(
			id: "tool-1",
			type: .tool,
			title: "List reminder lists",
			body: "",
			fullBody: nil,
			durationMs: nil,
			isActive: false,
			cacheHit: nil,
			toolName: "listReminderLists",
			count: 2,
			children: [
				WorkStep(
					id: "a",
					type: .tool,
					title: "List reminder lists",
					body: "Done 1.",
					fullBody: nil,
					durationMs: nil,
					isActive: false,
					cacheHit: nil,
					toolName: "listReminderLists",
					count: 1,
					children: []
				),
				WorkStep(
					id: "b",
					type: .tool,
					title: "List reminder lists",
					body: "Done 2.",
					fullBody: nil,
					durationMs: nil,
					isActive: false,
					cacheHit: nil,
					toolName: "listReminderLists",
					count: 1,
					children: []
				),
			]
		)
		let view = WorkStepExpandedBody(step: step)
		let texts = try view.inspect().findAll(ViewType.Text.self)
		let strings = texts.compactMap { try? $0.string() }
		#expect(strings.contains("Done 1."))
		#expect(strings.contains("Done 2."))
	}
}
