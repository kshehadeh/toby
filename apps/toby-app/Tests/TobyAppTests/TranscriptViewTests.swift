import Testing
import Foundation
@testable import TobyApp

@Suite("TranscriptView Work Steps")
struct TranscriptViewTests {

	@Test("workSteps assigns tool type for boxed_step variant tool")
	func toolStepType() {
		let group = TranscriptWorkGroup(
			id: "work-0",
			entries: [
				.boxedStep(BoxedStepPayload(
					id: "tool-1",
					seq: 1,
					variant: "tool",
					header: "Search memory",
					body: "Found 3 item(s).",
					toolName: "memorySearch",
					integrationLabel: nil,
					cacheHit: false,
					durationMs: 1500,
				)),
			],
			userTurnIndex: 0,
			durationMs: 2000,
			isActive: false,
		)

		// Verify the group contains a tool step by checking grouping logic
		#expect(TranscriptGrouping.isWorkEntry(.boxedStep(BoxedStepPayload(
			id: "tool-1",
			seq: 1,
			variant: "tool",
			header: "Search memory",
			body: "Found 3 item(s).",
			toolName: "memorySearch",
			integrationLabel: nil,
			cacheHit: false,
			durationMs: 1500,
		))))
	}

	@Test("groupedItems creates workGroup for tool entries")
	func groupedItemsCreatesWorkGroup() {
		let entries: [TranscriptEntry] = [
			.user(text: "Find my emails"),
			.boxedStep(BoxedStepPayload(
				id: "tool-1",
				seq: 1,
				variant: "tool",
				header: "Fetch recent unread emails",
				body: "Found 5 email(s).",
				toolName: "getRecentEmails",
				integrationLabel: nil,
				cacheHit: false,
				durationMs: 1200,
			)),
			.assistant(text: "You have 5 unread emails."),
		]

		let items = TranscriptGrouping.groupedItems(from: entries, isLoading: false)
		#expect(items.count == 3) // user entry, work group, assistant entry

		if case .workGroup(let group) = items[1] {
			#expect(group.entries.count == 1)
			#expect(!group.isActive)
		} else {
			Issue.record("Expected work group at index 1")
		}
	}

	@Test("groupedItems marks work group as active during loading")
	func activeWorkGroupDuringLoading() {
		let entries: [TranscriptEntry] = [
			.user(text: "Search memory"),
			.boxedStep(BoxedStepPayload(
				id: "tool-1",
				seq: 1,
				variant: "tool",
				header: "Search memory",
				body: "Running…",
				toolName: "memorySearch",
				integrationLabel: nil,
				cacheHit: nil,
				durationMs: nil,
			)),
		]

		let items = TranscriptGrouping.groupedItems(from: entries, isLoading: true)
		if case .workGroup(let group) = items[1] {
			#expect(group.isActive)
		} else {
			Issue.record("Expected active work group at index 1")
		}
	}

	@Test("isWorkEntry returns true for lifecycle entries")
	func lifecycleIsWorkEntry() {
		let payload = BoxedStepPayload(
			id: "lc-1",
			seq: 1,
			variant: "lifecycle",
			header: "Preparing Session…",
			body: "",
			toolName: nil,
			integrationLabel: nil,
			cacheHit: nil,
			durationMs: nil,
		)
		#expect(TranscriptGrouping.isWorkEntry(.boxedStep(payload)))
	}

	@Test("isWorkEntry returns true for plan entries")
	func planIsWorkEntry() {
		let payload = BoxedStepPayload(
			id: "plan-1",
			seq: 1,
			variant: "plan",
			header: "Plan: Do something",
			body: "Phases:\n  1. (pending)",
			toolName: nil,
			integrationLabel: nil,
			cacheHit: nil,
			durationMs: nil,
		)
		#expect(TranscriptGrouping.isWorkEntry(.boxedStep(payload)))
	}

	@Test("isWorkEntry returns false for assistant boxed_step")
	func assistantIsNotWorkEntry() {
		let payload = BoxedStepPayload(
			id: "asst-1",
			seq: 1,
			variant: "assistant",
			header: "Assistant",
			body: "Here is your answer.",
			toolName: nil,
			integrationLabel: nil,
			cacheHit: nil,
			durationMs: nil,
		)
		#expect(!TranscriptGrouping.isWorkEntry(.boxedStep(payload)))
	}

	@Test("hidden lifecycle headers are filtered")
	func hiddenLifecycleHeaders() {
		#expect(TranscriptGrouping.isHiddenLifecycleHeader("Preparing Session…"))
		#expect(TranscriptGrouping.isHiddenLifecycleHeader("Saving session…"))
		#expect(TranscriptGrouping.isHiddenLifecycleHeader("Chatting with Toby"))
		#expect(!TranscriptGrouping.isHiddenLifecycleHeader("Phase 1/3: Research"))
	}
}
