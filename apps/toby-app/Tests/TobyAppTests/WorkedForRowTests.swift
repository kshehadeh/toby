import Testing
import SwiftUI
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("WorkedForRow")
struct WorkedForRowTests {

	@Test("completed work uses minimum display duration when duration is unavailable")
	func minimumWorkLabelWhenDurationIsMissing() {
		#expect(workedSummaryLabel(duration: nil) == "Worked for 0.1s")
	}

	@Test("completed work uses minimum display duration for sub-second durations")
	func minimumWorkLabelForSubsecondDuration() {
		#expect(workedSummaryLabel(duration: 0.4) == "Worked for 0.4s")
	}

	@Test("completed work includes formatted duration when available")
	func formattedWorkLabel() {
		#expect(workedSummaryLabel(duration: 1.2) == "Worked for 1s")
	}

	@Test("activity durations use compact non-decorative precision")
	func compactActivityDurations() {
		#expect(formatActivityDuration(0.05) == "0.1s")
		#expect(formatActivityDuration(0.9) == "0.9s")
		#expect(formatActivityDuration(14) == "14s")
		#expect(formatActivityDuration(72) == "1m 12s")
	}

	@Test("aggregated executions count as one displayed step")
	func aggregatedExecutionsCountAsOneStep() {
		let repeated = WorkStep(
			id: "a",
			type: .tool,
			title: "Search the web",
			body: "",
			fullBody: nil,
			durationMs: 300,
			isActive: false,
			cacheHit: nil,
			toolName: "webSearch",
			count: 3,
			children: []
		)
		let model = WorkActivityModel(
			group: TranscriptWorkGroup(
				id: "work-0",
				entries: [],
				userTurnIndex: 0,
				durationMs: 300,
				isActive: false
			),
			steps: [repeated],
			duration: 0.3
		)

		#expect(model.stepCount == 1)
		#expect(model.summary == "1 step · 1 tools")
	}

	@Test("done activity model summarizes steps and unique real tool names")
	func doneActivitySummary() {
		let model = WorkActivityModel(
			group: TranscriptWorkGroup(
				id: "work-0",
				entries: [],
				userTurnIndex: 0,
				durationMs: 14_000,
				isActive: false
			),
			steps: [
				activityStep(id: "a", toolName: "webSearch"),
				activityStep(id: "b", toolName: "webSearch"),
				activityStep(id: "c", toolName: "readTranscript"),
			],
			duration: 14
		)

		#expect(model.title == "Worked for 14s")
		#expect(model.summary == "3 steps · 2 tools")
		#expect(model.tools == ["webSearch", "readTranscript"])
	}

	@Test("running activity model shows elapsed time and plan progress")
	func runningActivitySummary() {
		let model = WorkActivityModel(
			group: TranscriptWorkGroup(
				id: "work-0",
				entries: [],
				userTurnIndex: 0,
				durationMs: nil,
				isActive: true
			),
			steps: [
				activityStep(id: "plan", title: "Phase 2/3: Search", toolName: nil),
			],
			duration: 14
		)

		#expect(model.title == "Working…")
		#expect(model.summary == "14s · step 2 of 3")
	}

	@Test("failed activity model preserves backend error copy")
	func failedActivitySummary() {
		let error = "Reconnect Slack, then retry this request."
		let model = WorkActivityModel(
			group: TranscriptWorkGroup(
				id: "work-0",
				entries: [],
				userTurnIndex: 0,
				durationMs: 14_000,
				isActive: false,
				errorText: error
			),
			steps: [activityStep(id: "a", toolName: "searchSlack")],
			duration: 14
		)

		#expect(model.title == "Stopped after 14s")
		#expect(model.summary == "1 of 1 steps · 1 error")
		#expect(model.errorText == error)
	}

	@Test("collapsed activity card renders only its header button")
	func collapsedCardIsHeaderOnly() throws {
		let group = TranscriptWorkGroup(
			id: "work-0",
			entries: [.boxedStep(activityPayload())],
			userTurnIndex: 0,
			durationMs: 14_000,
			isActive: false
		)
		let view = WorkedForRow(
			group: group,
			duration: 14,
			activeWorkStartDate: nil,
			isExpanded: false,
			onToggle: {}
		)

		#expect(try view.inspect().findAll(ViewType.Button.self).count == 1)
		#expect(throws: (any Error).self) { try view.inspect().find(text: "Tools") }
		#expect(throws: (any Error).self) { try view.inspect().find(text: "Search the web") }
	}

	@Test("expanded activity card renders step and camelCase tool chip")
	func expandedCardShowsRowsAndTools() throws {
		let group = TranscriptWorkGroup(
			id: "work-0",
			entries: [.boxedStep(activityPayload())],
			userTurnIndex: 0,
			durationMs: 14_000,
			isActive: false
		)
		let view = WorkedForRow(
			group: group,
			duration: 14,
			activeWorkStartDate: nil,
			isExpanded: true,
			onToggle: {}
		)

		#expect(try view.inspect().find(text: "Search the web").string() == "Search the web")
		#expect(try view.inspect().find(text: "Tools").string() == "Tools")
		#expect(try view.inspect().find(text: "webSearch").string() == "webSearch")
	}

	@Test("work summary falls back to recorded step durations")
	func workStepDurationFallback() {
		let steps = [
			WorkStep(
				id: "search",
				type: .tool,
				title: "Search",
				body: "Done.",
				fullBody: nil,
				durationMs: 600,
				isActive: false,
				cacheHit: false,
				toolName: "search",
				count: 1,
				children: []
			),
			WorkStep(
				id: "fetch",
				type: .tool,
				title: "Fetch",
				body: "Done.",
				fullBody: nil,
				durationMs: 400,
				isActive: false,
				cacheHit: false,
				toolName: "fetch",
				count: 1,
				children: []
			),
		]

		#expect(workStepDuration(from: steps) == 1)
		#expect(workedSummaryLabel(duration: workStepDuration(from: steps)) == "Worked for 1s")
	}

	@Test("WorkStepRow is a button when it has more body text to show")
	func workStepRowWithLongBodyIsAButton() throws {
		let step = WorkStep(
			id: "tool-1",
			type: .tool,
			title: "Search memory",
			body: """
			Line 1
			Line 2
			Line 3
			Line 4
			Line 5
			""",
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

	@Test("WorkStepRow is not a button when body fits in collapsed view")
	func workStepRowWithShortBodyIsNotAButton() throws {
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
		#expect(throws: (any Error).self) {
			try view.inspect().find(ViewType.Button.self)
		}
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

	@Test("completed work group does not mark a leftover Running body as active")
	func completedGroupDoesNotKeepRunningStepActive() {
		let group = TranscriptWorkGroup(
			id: "work-0",
			entries: [
				.boxedStep(BoxedStepPayload(
					id: "archive-1",
					seq: 1,
					variant: "tool",
					header: "Email (IMAP/SMTP): Archive email",
					body: "Running…",
					toolName: "archiveEmail",
					integrationLabel: "Email (IMAP/SMTP)",
					cacheHit: nil,
					durationMs: nil,
					toolRuns: nil,
					fullBody: nil,
				)),
			],
			userTurnIndex: 0,
			durationMs: 104_000,
			isActive: false,
		)

		let steps = workSteps(from: group)
		#expect(steps.count == 1)
		#expect(steps[0].isActive == false)
		#expect(steps[0].title == "Email (IMAP/SMTP): Archive email")
	}

	@Test("work-step cache key changes when a tool body updates in place")
	func workStepsCacheKeyChangesOnInPlaceComplete() {
		func group(body: String, durationMs: Int?, isActive: Bool) -> TranscriptWorkGroup {
			TranscriptWorkGroup(
				id: "work-0",
				entries: [
					.boxedStep(BoxedStepPayload(
						id: "archive-1",
						seq: 1,
						variant: "tool",
						header: "Email (IMAP/SMTP): Archive email",
						body: body,
						toolName: "archiveEmail",
						integrationLabel: "Email (IMAP/SMTP)",
						cacheHit: false,
						durationMs: durationMs,
						toolRuns: nil,
						fullBody: nil,
					)),
				],
				userTurnIndex: 0,
				durationMs: isActive ? nil : 104_000,
				isActive: isActive,
			)
		}

		let running = WorkStepsCacheKey(group: group(body: "Running…", durationMs: nil, isActive: true))
		let completed = WorkStepsCacheKey(group: group(
			body: "Archived 1 message(s).",
			durationMs: 104_000,
			isActive: false,
		))
		let sameRunningAgain = WorkStepsCacheKey(group: group(body: "Running…", durationMs: nil, isActive: true))

		#expect(running != completed)
		#expect(running == sameRunningAgain)
		#expect(running.entryCount == completed.entryCount)
	}

	@Test("completed work step with leftover Running body does not render a spinner")
	func completedRunningBodyDoesNotRenderSpinner() throws {
		let step = WorkStep(
			id: "archive-1",
			type: .tool,
			title: "Email (IMAP/SMTP): Archive email",
			body: "Running…",
			fullBody: nil,
			durationMs: nil,
			isActive: false,
			cacheHit: nil,
			toolName: "archiveEmail",
			count: 1,
			children: []
		)
		let view = WorkStepHeader(step: step, isExpanded: false, icon: "envelope")
		#expect(throws: (any Error).self) {
			try view.inspect().find(ViewType.ProgressView.self)
		}
		#expect(try view.inspect().find(text: "Running…").string() == "Running…")
	}

	private func activityStep(
		id: String,
		title: String = "Search the web",
		toolName: String?
	) -> WorkStep {
		WorkStep(
			id: id,
			type: .tool,
			title: title,
			body: "Found a result.",
			fullBody: nil,
			durationMs: 100,
			isActive: false,
			cacheHit: false,
			toolName: toolName,
			count: 1,
			children: []
		)
	}

	private func activityPayload() -> BoxedStepPayload {
		BoxedStepPayload(
			id: "tool-1",
			seq: 1,
			variant: "tool",
			header: "Search the web",
			body: "Found a result.",
			toolName: "webSearch",
			integrationLabel: nil,
			cacheHit: false,
			durationMs: 100,
			toolRuns: nil,
			fullBody: nil
		)
	}
}
