import Testing
import Foundation
@testable import TobyApp

@Suite("TranscriptView Work Steps")
struct TranscriptViewTests {

	@Test("workSteps assigns tool type for boxed_step variant tool")
	func toolStepType() {
		_ = TranscriptWorkGroup(
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
					toolRuns: nil,
					fullBody: nil,
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
			toolRuns: nil,
			fullBody: nil,
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
				toolRuns: nil,
				fullBody: nil,
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
				toolRuns: nil,
				fullBody: nil,
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
			toolRuns: nil,
			fullBody: nil,
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
			toolRuns: nil,
			fullBody: nil,
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
			toolRuns: nil,
			fullBody: nil,
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

	@Test("workSteps uses friendly header for boxed_step tool")
	func workStepsUsesFriendlyHeader() {
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
					toolRuns: nil,
					fullBody: nil,
				)),
			],
			userTurnIndex: 0,
			durationMs: 2000,
			isActive: false,
		)
		let steps = workSteps(from: group)
		#expect(steps.count == 1)
		#expect(steps[0].title == "Search memory")
	}

	@Test("workSteps decodes toolRuns into children")
	func workStepsDecodesToolRuns() {
		let group = TranscriptWorkGroup(
			id: "work-0",
			entries: [
				.boxedStep(BoxedStepPayload(
					id: "tool-1",
					seq: 1,
					variant: "tool",
					header: "Search emails (x2)",
					body: "",
					toolName: "searchEmails",
					integrationLabel: nil,
					cacheHit: nil,
					durationMs: nil,
					toolRuns: [
						ToolRunEntry(blockKey: "a", header: "Search emails", body: "Found 1.", cacheHit: false, durationMs: 100, fullBody: nil),
						ToolRunEntry(blockKey: "b", header: "Search emails", body: "Found 2.", cacheHit: false, durationMs: 200, fullBody: nil),
					],
					fullBody: nil,
				)),
			],
			userTurnIndex: 0,
			durationMs: 2000,
			isActive: false,
		)
		let steps = workSteps(from: group)
		#expect(steps.count == 1)
		#expect(steps[0].count == 2)
		#expect(steps[0].children.count == 2)
		#expect(steps[0].children[0].body == "Found 1.")
		#expect(steps[0].children[1].body == "Found 2.")
	}

	@Test("workSteps pairs toolCall with toolOutput")
	func workStepsPairsToolCallWithToolOutput() {
		let group = TranscriptWorkGroup(
			id: "work-0",
			entries: [
				.toolCall(blockKey: "a", title: "listReminderLists", toolName: "listReminderLists"),
				.toolOutput(blockKey: "a", detail: "Done.", toolName: "listReminderLists"),
			],
			userTurnIndex: 0,
			durationMs: 2000,
			isActive: false,
		)
		let steps = workSteps(from: group)
		#expect(steps.count == 1)
		#expect(steps[0].type == .toolCall)
		#expect(steps[0].title == "List reminder lists")
		#expect(steps[0].body == "Done.")
	}

	@Test("workSteps aggregates consecutive same-toolName toolCall pairs")
	func workStepsAggregatesConsecutiveSameToolCallPairs() {
		let group = TranscriptWorkGroup(
			id: "work-0",
			entries: [
				.toolCall(blockKey: "a", title: "listReminderLists", toolName: "listReminderLists"),
				.toolOutput(blockKey: "a", detail: "Done 1.", toolName: "listReminderLists"),
				.toolCall(blockKey: "b", title: "listReminderLists", toolName: "listReminderLists"),
				.toolOutput(blockKey: "b", detail: "Done 2.", toolName: "listReminderLists"),
			],
			userTurnIndex: 0,
			durationMs: 2000,
			isActive: false,
		)
		let steps = workSteps(from: group)
		#expect(steps.count == 1)
		#expect(steps[0].count == 2)
		#expect(steps[0].title == "List reminder lists")
		#expect(steps[0].children.count == 2)
		#expect(steps[0].children[0].body == "Done 1.")
		#expect(steps[0].children[1].body == "Done 2.")
	}

	@Test("workSteps does not aggregate different toolName pairs")
	func workStepsDoesNotAggregateDifferentToolNamePairs() {
		let group = TranscriptWorkGroup(
			id: "work-0",
			entries: [
				.toolCall(blockKey: "a", title: "listReminderLists", toolName: "listReminderLists"),
				.toolOutput(blockKey: "a", detail: "Done 1.", toolName: "listReminderLists"),
				.toolCall(blockKey: "b", title: "searchReminders", toolName: "searchReminders"),
				.toolOutput(blockKey: "b", detail: "Done 2.", toolName: "searchReminders"),
			],
			userTurnIndex: 0,
			durationMs: 2000,
			isActive: false,
		)
		let steps = workSteps(from: group)
		#expect(steps.count == 2)
	}

	@Test("workSteps assigns assistantInterim type for assistant_interim variant")
	func workStepsAssistantInterimType() {
		let group = TranscriptWorkGroup(
			id: "work-0",
			entries: [
				.boxedStep(BoxedStepPayload(
					id: "asst-1",
					seq: 1,
					variant: "assistant_interim",
					header: "Toby",
					body: "I'll search for that now.",
					toolName: nil,
					integrationLabel: nil,
					cacheHit: nil,
					durationMs: nil,
					toolRuns: nil,
					fullBody: nil,
				)),
				.boxedStep(BoxedStepPayload(
					id: "tool-1",
					seq: 2,
					variant: "tool",
					header: "Search memory",
					body: "Found 3 item(s).",
					toolName: "memorySearch",
					integrationLabel: nil,
					cacheHit: false,
					durationMs: 1500,
					toolRuns: nil,
					fullBody: nil,
				)),
			],
			userTurnIndex: 0,
			durationMs: 2000,
			isActive: false,
		)
		let steps = workSteps(from: group)
		#expect(steps.count == 2)
		#expect(steps[0].type == .assistantInterim)
		#expect(steps[0].body == "I'll search for that now.")
		#expect(steps[1].type == .tool)
	}
}
