import Testing
import Foundation
@testable import TobyApp

@Suite("ToolDisplayLabels")
struct ToolDisplayLabelsTests {

	// MARK: - displayLabel

	@Test("returns override label for known tool names")
	func returnsOverrideForKnownTools() {
		#expect(ToolDisplayLabels.displayLabel("askUser") == "Ask you to choose")
		#expect(ToolDisplayLabels.displayLabel("getRecentEmails") == "Fetch recent unread emails")
		#expect(ToolDisplayLabels.displayLabel("memorySearch") == "Search memory")
		#expect(ToolDisplayLabels.displayLabel("listUsers") == "List Azure AD users")
	}

	@Test("humanizes unknown camelCase tool names")
	func humanizesUnknownCamelCase() {
		#expect(ToolDisplayLabels.displayLabel("tobyListIntegrations") == "Toby list integrations")
		#expect(ToolDisplayLabels.displayLabel("createCalendarEvent") == "Create calendar event")
	}

	@Test("humanizes snake_case tool names")
	func humanizesSnakeCase() {
		#expect(ToolDisplayLabels.displayLabel("send_email") == "Send email")
	}

	@Test("handles tool names with ID suffix")
	func handlesIDSuffix() {
		#expect(ToolDisplayLabels.displayLabel("getUserById") == "Get user by ID")
	}

	// MARK: - formatToolOutput

	@Test("returns Done for nil result")
	func doneForNilResult() {
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: nil, error: nil) == "Done.")
	}

	@Test("returns Failed prefix for error")
	func errorFormatting() {
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: nil, error: "Network timeout") == "Failed: Network timeout")
	}

	@Test("returns count for array results")
	func arrayResults() {
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: [1, 2, 3], error: nil) == "Returned 3 item(s).")
	}

	@Test("returns string result sanitized")
	func stringResult() {
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: "Hello world", error: nil) == "Hello world")
	}

	@Test("sanitizes multiline string result")
	func multilineStringResult() {
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: "Line 1\nLine 2", error: nil) == "Line 1 Line 2")
	}

	@Test("returns Done for boolean true")
	func boolTrueResult() {
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: true, error: nil) == "Done.")
	}

	@Test("returns No result for boolean false")
	func boolFalseResult() {
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: false, error: nil) == "No result.")
	}

	@Test("extracts message from object result")
	func objectMessageResult() {
		let result: [String: Any] = ["message": "Operation succeeded"]
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: result, error: nil) == "Operation succeeded")
	}

	@Test("extracts summary from object result")
	func objectSummaryResult() {
		let result: [String: Any] = ["summary": "Found 3 conflicts"]
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: result, error: nil) == "Found 3 conflicts")
	}

	@Test("counts items array in object result")
	func objectItemsArray() {
		let result: [String: Any] = ["items": ["a", "b"]]
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: result, error: nil) == "Found 2 item(s).")
	}

	@Test("counts events array in object result")
	func objectEventsArray() {
		let result: [String: Any] = ["events": [1, 2, 3, 4]]
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: result, error: nil) == "Found 4 event(s).")
	}

	@Test("returns Done for object with success true")
	func objectSuccessTrue() {
		let result: [String: Any] = ["success": true]
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: result, error: nil) == "Done.")
	}

	@Test("returns error message from object error field")
	func objectErrorField() {
		let result: [String: Any] = ["error": "Permission denied"]
		#expect(ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: result, error: nil) == "Error: Permission denied")
	}

	@Test("truncates long string results")
	func truncatesLongStrings() {
		let longString = String(repeating: "a", count: 300)
		let result = ToolDisplayLabels.formatToolOutput(toolName: "test", args: nil, result: longString, error: nil)
		#expect(result.count <= 200)
	}

	// MARK: - formatToolCallHeader

	@Test("formats header with friendly label")
	func headerWithFriendlyLabel() {
		let header = ToolDisplayLabels.formatToolCallHeader(toolName: "memorySearch", args: nil, integrationLabel: nil)
		#expect(header == "Search memory")
	}

	@Test("formats header with integration label prefix")
	func headerWithIntegrationLabel() {
		let header = ToolDisplayLabels.formatToolCallHeader(toolName: "listUsers", args: nil, integrationLabel: "Azure AD")
		#expect(header == "Azure AD: List Azure AD users")
	}

	@Test("formats header with query argument summary")
	func headerWithQueryArg() {
		let args: [String: Any] = ["query": "open tasks"]
		let header = ToolDisplayLabels.formatToolCallHeader(toolName: "searchUsers", args: args, integrationLabel: nil)
		#expect(header == "Search Azure AD users · \u{201C}open tasks\u{201D}")
	}

	@Test("formats header with ID argument summary")
	func headerWithIdArg() {
		let args: [String: Any] = ["id": "abc123"]
		let header = ToolDisplayLabels.formatToolCallHeader(toolName: "getUser", args: args, integrationLabel: nil)
		#expect(header == "Get Azure AD user · abc123")
	}

	@Test("omits args summary for askUser tool")
	func headerOmitsArgsForAskUser() {
		let args: [String: Any] = ["query": "Which option?"]
		let header = ToolDisplayLabels.formatToolCallHeader(toolName: "askUser", args: args, integrationLabel: nil)
		#expect(header == "Ask you to choose")
	}

	// MARK: - iconForTool

	@Test("returns calendar icon for calendar-related tools")
	func calendarIcon() {
		#expect(ToolDisplayLabels.iconForTool("searchCalendarEvents") == "calendar")
		#expect(ToolDisplayLabels.iconForTool("createCalendarEvent") == "calendar")
		#expect(ToolDisplayLabels.iconForTool("listEvents") == "calendar")
	}

	@Test("returns envelope icon for email-related tools")
	func emailIcon() {
		#expect(ToolDisplayLabels.iconForTool("getRecentEmails") == "envelope")
		#expect(ToolDisplayLabels.iconForTool("getInboxUnreadOverview") == "envelope")
		#expect(ToolDisplayLabels.iconForTool("createDraft") == "envelope")
		#expect(ToolDisplayLabels.iconForTool("archiveEmailById") == "envelope")
	}

	@Test("returns checklist icon for task-related tools")
	func taskIcon() {
		#expect(ToolDisplayLabels.iconForTool("fetchOpenTasks") == "checklist")
		#expect(ToolDisplayLabels.iconForTool("createTask") == "checklist")
		#expect(ToolDisplayLabels.iconForTool("completeTask") == "checklist")
		#expect(ToolDisplayLabels.iconForTool("listProjectNames") == "checklist")
	}

	@Test("returns person icon for user-related tools")
	func userIcon() {
		#expect(ToolDisplayLabels.iconForTool("listUsers") == "person.2")
		#expect(ToolDisplayLabels.iconForTool("getUser") == "person.2")
		#expect(ToolDisplayLabels.iconForTool("getUserManager") == "person.2")
		#expect(ToolDisplayLabels.iconForTool("getUserDirectReports") == "person.2")
	}

	@Test("returns brain icon for memory tools")
	func memoryIcon() {
		#expect(ToolDisplayLabels.iconForTool("memorySearch") == "brain.head.profile")
		#expect(ToolDisplayLabels.iconForTool("memorySave") == "brain.head.profile")
		#expect(ToolDisplayLabels.iconForTool("memoryRetrieveForTask") == "brain.head.profile")
	}

	@Test("returns waveform icon for listen/transcript tools")
	func listenIcon() {
		#expect(ToolDisplayLabels.iconForTool("listListenRecordings") == "waveform")
		#expect(ToolDisplayLabels.iconForTool("readTranscript") == "waveform")
	}

	@Test("returns magnifyingglass for web search")
	func webSearchIcon() {
		#expect(ToolDisplayLabels.iconForTool("webSearch") == "magnifyingglass")
	}

	@Test("returns globe for web fetch")
	func webFetchIcon() {
		#expect(ToolDisplayLabels.iconForTool("fetchWebContent") == "globe")
	}

	@Test("returns bubble icon for slack/messaging tools")
	func slackIcon() {
		#expect(ToolDisplayLabels.iconForTool("postToChannel") == "bubble.left")
		#expect(ToolDisplayLabels.iconForTool("replyToPost") == "bubble.left")
		#expect(ToolDisplayLabels.iconForTool("searchChannels") == "bubble.left")
	}

	@Test("returns tag icon for label tools")
	func labelIcon() {
		#expect(ToolDisplayLabels.iconForTool("listLabels") == "tag")
		#expect(ToolDisplayLabels.iconForTool("createAndApplyLabel") == "tag")
		#expect(ToolDisplayLabels.iconForTool("applyMultipleLabels") == "tag")
	}

	@Test("returns puzzlepiece for integration tools")
	func integrationIcon() {
		#expect(ToolDisplayLabels.iconForTool("tobyListIntegrations") == "puzzlepiece")
		#expect(ToolDisplayLabels.iconForTool("tobyGetIntegrationSetup") == "puzzlepiece")
	}

	@Test("returns wand icon for skill tools")
	func skillIcon() {
		#expect(ToolDisplayLabels.iconForTool("createLocalSkill") == "wand.and.stars")
		#expect(ToolDisplayLabels.iconForTool("tobyListSkills") == "wand.and.stars")
	}

	@Test("returns clock for datetime tool")
	func dateTimeIcon() {
		#expect(ToolDisplayLabels.iconForTool("getCurrentDateTime") == "clock")
	}

	@Test("returns doc for file tools")
	func fileIcon() {
		#expect(ToolDisplayLabels.iconForTool("writeTextFile") == "doc")
	}

	@Test("returns questionmark.bubble for askUser")
	func askUserIcon() {
		#expect(ToolDisplayLabels.iconForTool("askUser") == "questionmark.bubble")
	}

	@Test("returns wrench fallback for unknown tools")
	func fallbackIcon() {
		#expect(ToolDisplayLabels.iconForTool("someUnknownTool") == "wrench.and.screwdriver")
	}

	@Test("returns sparkles for toby-prefixed tools without specific override")
	func tobyPrefixIcon() {
		#expect(ToolDisplayLabels.iconForTool("tobyInstanceInfo") == "info.circle")
		#expect(ToolDisplayLabels.iconForTool("tobyListDefaults") == "sparkles")
	}
}
