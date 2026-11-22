import Foundation
import Testing
import TobyAI
@testable import TobyCore

/// Records native calls and replies from a script.
final class FakeBridge: NativeBridge, @unchecked Sendable {
	private let lock = NSLock()
	private var calls: [(String, JSONValue)] = []
	let replies: [String: JSONValue]

	init(_ replies: [String: JSONValue]) { self.replies = replies }

	var recorded: [(String, JSONValue)] { lock.withLock { calls } }

	func call(_ endpoint: String, _ body: JSONValue) async -> JSONValue {
		lock.withLock { calls.append((endpoint, body)) }
		return replies[endpoint] ?? ["ok": false, "error": "no reply"]
	}
}

@Suite("Apple tools")
struct AppleToolsTests {
	@Test func generatedDefinitionsCoverThePluginTools() {
		let names = Set(AppleTools.definitions.map(\.name))
		#expect(AppleTools.definitions.count == 47)
		#expect(names.isSuperset(of: ["searchCalendarEvents", "createReminder", "searchContacts", "macWifiSetPower", "macFocusSet"]))
		for definition in AppleTools.definitions where definition.name != "macNotificationsPeek" {
			#expect(AppleTools.endpoints[definition.name] != nil, "\(definition.name) has no endpoint")
		}
	}

	@Test func shapesRequestBodiesLikeThePlugins() {
		#expect(AppleTools.body(for: "macFocusSet", ["enabled": true]) == ["name": "TobyFocusOn"])
		#expect(AppleTools.body(for: "macWindowMinimizeApp", ["appName": "Safari"]) == ["name": "Safari"])
		#expect(AppleTools.body(for: "completeReminder", ["id": "r1"]) == ["id": "r1", "completed": true])
		#expect(AppleTools.body(for: "searchCalendarEvents", ["query": "", "limit": 500, "calendar": .null]) == ["limit": 200])
	}

	@Test func executesThroughTheBridgeAndReportsPermissionErrors() async throws {
		let bridge = FakeBridge([
			"macos/wifi-set-power": ["ok": true, "data": ["enabled": false]],
			"calendar/list": ["ok": false, "error": "Calendar access denied", "needsPermission": true],
		])
		let tools = Dictionary(AppleTools(bridge: bridge).tools(dryRun: false).map { ($0.tool.name, $0.tool) }, uniquingKeysWith: { a, _ in a })
		let wifi = try await tools["macWifiSetPower"]!.execute(["enabled": false], ToolContext(toolCallId: "1"))
		#expect(wifi == ["enabled": false])
		let calendars = try await tools["listCalendars"]!.execute([:], ToolContext(toolCallId: "2"))
		#expect(calendars["needsPermission"] == true)
		#expect(bridge.recorded.map(\.0) == ["macos/wifi-set-power", "calendar/list"])
		let dry = Dictionary(AppleTools(bridge: bridge).tools(dryRun: true).map { ($0.tool.name, $0.tool) }, uniquingKeysWith: { a, _ in a })
		#expect(try await dry["macWifiSetPower"]!.execute(["enabled": true], ToolContext(toolCallId: "3"))["dryRun"] == true)
		#expect(bridge.recorded.count == 2)
	}

	@Test func meetingNotesMatchesThePlugin() {
		let input = "Agenda: Q4 review\n\n________________________________________________________________________________\nMicrosoft Teams meeting\nJoin on your computer\nMeeting ID: 123\n________________________________________________________________________________\nBring numbers\n+1 415-555-0100,,123#\n<b>Notes</b> here\n-----\nhttps://zoom.us/j/1"
		#expect(AppleTools.meetingNotes(input) == "Agenda: Q4 review\nBring numbers\nNotes  here")
	}

	@Test func summarizesEventsAndRemindersWithUrgency() async throws {
		let now = TodoRecurrence.parseISO("2027-01-04T09:00:00Z")!
		let bridge = FakeBridge([
			"calendar/search": ["ok": true, "data": ["count": 2, "events": [
				["uid": "e1", "summary": "Standup", "calendar": "Work", "startDate": "2027-01-04T09:30:00Z", "endDate": "2027-01-04T09:45:00Z", "isAllDay": false],
				["uid": "e2", "summary": "Offsite", "calendar": "Work", "startDate": "2027-01-07T00:00:00Z", "isAllDay": true, "location": "Lisbon"],
			]]],
			"reminders/search": ["ok": true, "data": ["reminders": [
				["id": "r 1", "title": "Pay rent", "list": "Home", "dueDate": "2027-01-03T12:00:00Z", "priority": 5],
			]]],
		])
		let apple = AppleTools(bridge: bridge)
		let events = try await apple.upcomingEvents(now: now)
		#expect(events["items"]?[0]?["urgency"] == "high")
		#expect(events["items"]?[1]?["urgency"] == "low")
		#expect(events["items"]?[1]?["detail"] == "Lisbon")
		#expect(events["groups"] == [["id": "Work", "label": "Work", "count": 2]])
		let reminders = try await apple.openReminders(now: now)
		#expect(reminders["items"]?[0]?["urgency"] == "high")
		#expect(reminders["items"]?[0]?["url"] == "x-apple-reminderkit://REMCDReminder/r%201")
	}
}
