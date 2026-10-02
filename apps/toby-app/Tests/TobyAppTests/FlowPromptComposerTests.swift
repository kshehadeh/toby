import Testing
@testable import TobyApp

@Suite("Flow prompt composer")
struct FlowPromptComposerTests {
	private let handWritten = """
	Open tasks:
	{{json bag.tasks}}

	Upcoming events:
	{{dashboardItems bag.calendar}}

	Recommend the one thing I should work on next and why.
	"""

	@Test("splits labeled data lines from the instructions")
	func splitsDataFromInstructions() throws {
		let parsed = try #require(FlowPromptComposer.parse(handWritten))
		#expect(parsed.instructions == "Recommend the one thing I should work on next and why.")
		#expect(parsed.keys == ["tasks", "calendar"])
		#expect(parsed.items.map(\.label) == ["Open tasks", "Upcoming events"])
		#expect(parsed.items[1].token == "{{dashboardItems bag.calendar}}")
		#expect(parsed.dataFirst)
	}

	@Test("composing an untouched prompt gives it back unchanged")
	func roundTripsUntouchedPrompts() throws {
		for prompt in [
			handWritten,
			"{{json bag.upcoming}}",
			"Previous step output:\n\n{{json bag.result}}",
			"Summarize this.",
		] {
			let parsed = try #require(FlowPromptComposer.parse(prompt))
			#expect(parsed.compose() == prompt)
		}
	}

	@Test("editing instructions keeps the data where it was")
	func editingInstructionsKeepsData() throws {
		var parsed = try #require(FlowPromptComposer.parse(handWritten))
		parsed.instructions = "Pick one task for this morning."
		#expect(parsed.compose() == """
		Open tasks:
		{{json bag.tasks}}

		Upcoming events:
		{{dashboardItems bag.calendar}}

		Pick one task for this morning.
		""")
	}

	@Test("toggling data adds and removes labeled blocks")
	func togglesData() throws {
		let parsed = try #require(FlowPromptComposer.parse("Recommend what to do next."))
		let withJira = parsed.including(key: "jira", label: "Search issues")
		#expect(withJira.compose() == "Recommend what to do next.\n\nSearch issues:\n{{json bag.jira}}")
		#expect(withJira.including(key: "jira", label: "Again").items.count == 1)
		#expect(withJira.excluding(key: "jira").compose() == "Recommend what to do next.")
	}

	@Test("prompts with data inside sentences stay as written")
	func inlineDataFallsBackToRaw() {
		let inline = "Summarize {{json bag.tasks}} in one line."
		#expect(FlowPromptComposer.parse(inline) == nil)
		#expect(FlowPromptComposer.parse("Use {{inputs.limit}}") == nil)
		#expect(FlowPromptComposer.parse("{{json bag.a}}\n{{bag.a}}") == nil)
		#expect(FlowPromptComposer.referencedKeys(in: inline) == ["tasks"])
		#expect(FlowPromptComposer.removingReferences(to: "tasks", from: inline) == "Summarize  in one line.")
		#expect(
			FlowPromptComposer.appendingReference(to: "jira", label: "Search issues", in: inline)
				== "\(inline)\n\nSearch issues:\n{{json bag.jira}}"
		)
	}

	@Test("raw removal drops the heading above a data line")
	func rawRemovalDropsHeading() {
		let prompt = "Say hi to {{bag.name}}.\n\nOpen tasks:\n{{json bag.tasks}}"
		#expect(FlowPromptComposer.removingReferences(to: "tasks", from: prompt) == "Say hi to {{bag.name}}.")
	}
}
