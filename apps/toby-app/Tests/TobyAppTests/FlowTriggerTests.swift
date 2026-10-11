import Foundation
import Testing
import SwiftUI
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("Flow triggers")
struct FlowTriggerTests {
    @Test("built-in Home refresh trigger decodes and has a readable label")
    func dashboardRefresh() throws {
        var body = FlowTriggerSpec.manual().jsonBody
        body["id"] = "dashboard-refresh"
        body["name"] = "Home refresh"
        body["source"] = ["type": "dashboard.refresh"]
        let trigger = try JSONDecoder().decode(FlowTriggerSpec.self, from: JSONSerialization.data(withJSONObject: body))
        #expect(trigger.enabled)
        #expect(!trigger.isUserInvoked)
        #expect(trigger.label == "When Home refreshes")
    }
    @Test("Home refresh requires a content card and replaces the Home action")
    func homeRefreshPlacement() {
        var draft = FlowEditorDraft.blank()
        draft.selectHomeAction()
        draft.selectHomeRefresh()
        #expect(!draft.hasHomeActionTrigger)
        #expect(draft.hasHomeRefreshTrigger)
        #expect(draft.destinations.last?.dashboardVariant == "informational")
        draft.triggers[draft.triggers.count - 1].enabled = false
        draft.synchronizeHomeActionDestination()
        #expect(draft.destinations.last?.dashboardVariant == "informational")
        draft.selectHomeAction()
        #expect(!draft.hasHomeRefreshTrigger)
        #expect(draft.destinations.last?.dashboardVariant == "runner")
    }
    @Test("per-file folder mode survives serialization")
    func perFileRoundTrip() throws {
        var trigger = FlowTriggerSpec.manual()
        trigger.changeSource("macos.fileChanges")
        trigger.source.folder = "/tmp/inbox"
        trigger.source.runPerFile = true
        let data = try JSONSerialization.data(withJSONObject: trigger.jsonBody)
        #expect(try JSONDecoder().decode(FlowTriggerSpec.self, from: data).source.runPerFile == true)
    }
    @Test("trigger settings survive editing and serialization")
    func roundTrip() throws {
        var trigger = FlowTriggerSpec.manual()
        trigger.changeSource("schedule")
        trigger.enabled = true
        trigger.conditions = .init(timezone: "America/New_York", weekdays: [1, 2], timeWindow: .init(start: "08:00", end: "12:00"))
        trigger.policy = .init(cooldownSeconds: 300, oncePerDay: true)
        trigger.inputs = ["topic": AnyCodable("Inbox")]
        trigger.eventInputMappings = ["time": "occurredAt"]
        trigger.notifyOnCompletion = true
        let data = try JSONSerialization.data(withJSONObject: trigger.jsonBody)
        #expect(try JSONDecoder().decode(FlowTriggerSpec.self, from: data) == trigger)
        var draft = FlowEditorDraft.blank()
        draft.triggers = [trigger]
        draft.projectId = "project.inbox"
        draft.revision = 4
        draft.nodes = [.llm()]
        var body = draft.jsonBody()
        body["id"] = "flow.inbox"
        let document = try JSONDecoder().decode(FlowDocumentPayload.self, from: JSONSerialization.data(withJSONObject: body))
        let restored = FlowEditorDraft.from(document: document)
        #expect(restored.triggers == [trigger])
        #expect(restored.projectId == "project.inbox")
        #expect(restored.revision == 4)
    }

    @Test("changing source clears stale mappings and disables automatic execution")
    func sourceChange() {
        var trigger = FlowTriggerSpec.manual()
        trigger.eventInputMappings = ["files": "payload.changes"]
        trigger.changeSource("macos.userReturned")
        #expect(!trigger.enabled)
        #expect(trigger.eventInputMappings.isEmpty)
        #expect(trigger.source.minimumIdleSeconds == 1800)
        #expect(trigger.source.folder == nil)
        trigger.changeSource("manual")
        #expect(trigger.enabled)
    }

    @Test("Agent Task editing preserves prompt and output wiring without LLM schema")
    func agentNodeRoundTrip() throws {
        let data = Data("""
        {"id":"agent","type":"agent_task","userPrompt":"Summarize {{json bag.trigger}}","systemPrompt":"Be concise","outputs":{"summary":"object"}}
        """.utf8)
        let node = FlowEditorNode(stored: try JSONDecoder().decode(FlowStoredNode.self, from: data))
        #expect(node.isLLM)
        let body = node.jsonBody()
        #expect(body["schema"] == nil)
        #expect(body["type"] as? String == "agent_task")
        #expect(body["userPrompt"] as? String == "Summarize {{json bag.trigger}}")
        #expect((body["outputs"] as? [String: String])?["summary"] == "object")
    }
    @Test("Home Screen Action forces a Home button and preserves its appearance")
    func homeActionPlacement() throws {
        var draft = FlowEditorDraft.blank()
        var home = FlowEditorDestination.dashboard()
        home.dashboardColor = "teal"
        draft.destinations.append(home)
        draft.triggers = [.homeAction()]
        draft.synchronizeHomeActionDestination()
        #expect(draft.hasHomeActionTrigger)
        #expect(draft.destinations.filter { $0.type == "dashboard" }.count == 1)
        #expect(draft.destinations.last?.dashboardVariant == "runner")
        #expect(draft.destinations.last?.dashboardColor == "teal")
        draft.triggers[0].enabled = false
        draft.synchronizeHomeActionDestination()
        #expect(draft.hasHomeActionTrigger)
        #expect(draft.destinations.last?.dashboardVariant == "runner")
        draft.nodes = [.llm()]
        var body = draft.jsonBody()
        body["id"] = "flow.home-action"
        let document = try JSONDecoder().decode(FlowDocumentPayload.self, from: JSONSerialization.data(withJSONObject: body))
        let restored = FlowEditorDraft.from(document: document)
        #expect(restored.hasHomeActionTrigger)
        #expect(restored.destinations.last?.dashboardVariant == "runner")
    }

    @Test("removing the last Home trigger unlocks placement and restores a Home card")
    func homeActionRemoval() {
        var draft = FlowEditorDraft.blank()
        draft.selectHomeAction()
        draft.selectHomeAction()
        #expect(draft.triggers.filter { $0.source.type == "home.action" }.count == 1)
        #expect(draft.triggers.last?.enabled == true)
        draft.triggers.removeAll { $0.source.type == "home.action" }
        draft.synchronizeHomeActionDestination(removingHomeAction: true)
        #expect(!draft.hasHomeActionTrigger)
        #expect(draft.destinations.last?.dashboardVariant == "informational")
        draft.triggers[0].changeSource("home.action")
        draft.synchronizeHomeActionDestination()
        #expect(draft.triggers[0].enabled)
        #expect(draft.destinations.last?.dashboardVariant == "runner")
    }

    @Test("Home location choices are disabled with a visible explanation while required")
    func homeActionLocationLock() throws {
        var destination = FlowEditorDestination.dashboard()
        destination.dashboardVariant = "runner"
        let view = FlowEditorDestinationCard(destination: .constant(destination), isHomeActionRequired: true, onRemove: {})
        let card = try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-home-card-choice")
        let action = try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-home-action-choice")
        #expect(try card.isDisabled())
        #expect(try action.isDisabled())
        #expect(throws: Never.self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-home-action-location-lock") }
        let unlocked = FlowEditorDestinationCard(destination: .constant(destination), onRemove: {})
        #expect(try !unlocked.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-home-card-choice").isDisabled())
    }

    @Test("triggers describe themselves in plain words")
    func plainSummaries() {
        var files = FlowTriggerSpec.manual()
        files.changeSource("macos.fileChanges")
        files.source.folder = "/Users/me/Downloads"
        files.source.extensions = ["png", ".JPG"]
        files.source.runPerFile = true
        #expect(files.plainSummary == "New .png and .jpg files in Downloads, one run each")
        files.source.kinds = ["new", "changed", "deleted"]
        files.source.extensions = []
        files.source.runPerFile = false
        #expect(files.plainSummary == "Files in Downloads")
        #expect(FlowTriggerSpec.scheduleSummary(cron: "0 9 * * 1-5") == "Weekdays at 9:00 AM")
        #expect(FlowTriggerSpec.scheduleSummary(cron: "30 17 * * *") == "Every day at 5:30 PM")
        #expect(FlowTriggerSpec.scheduleSummary(cron: "15 * * * *") == "Every hour at :15")
        #expect(FlowTriggerSpec.scheduleSummary(cron: "0 0 * * 1") == "Mondays at 12:00 AM")
        #expect(FlowTriggerSpec.scheduleSummary(cron: "*/5 * * * *") == nil)
        var idle = FlowTriggerSpec.manual()
        idle.changeSource("macos.userReturned")
        #expect(idle.plainSummary == "When you’re back after 30 min away")
    }

    @Test("limits read as one line and frequency maps onto the policy")
    func limitsSummary() {
        var trigger = FlowTriggerSpec.manual()
        #expect(trigger.limitsSummary == nil)
        trigger.changeSource("macos.fileChanges")
        trigger.policy = .init(cooldownSeconds: 0, oncePerDay: false)
        #expect(trigger.limitsSummary == "Any day, any time · waits 5 sec for quiet")
        trigger.conditions.weekdays = [1, 2, 3, 4, 5]
        trigger.conditions.timeWindow = .init(start: "08:00", end: "12:00")
        trigger.frequency = .oncePerDay
        #expect(trigger.policy == .init(cooldownSeconds: 0, oncePerDay: true))
        #expect(trigger.limitsSummary == "Weekdays, 08:00 to 12:00 · once a day · waits 5 sec for quiet")
        trigger.frequency = .spaced
        #expect(trigger.policy == .init(cooldownSeconds: 300, oncePerDay: false))
        trigger.conditions.weekdays = [1, 3]
        #expect(trigger.daysSummary == "Mon, Wed")
        #expect(trigger.limitsSummary?.contains("at most every 5 min") == true)
        trigger.frequency = .everyTime
        #expect(trigger.policy == .init(cooldownSeconds: 0, oncePerDay: false))
    }

    @Test("unnamed triggers keep a name that says what they do")
    func defaultNames() {
        var trigger = FlowTriggerSpec.manual()
        trigger.name = "New trigger"
        #expect(!trigger.hasCustomName)
        let before = trigger
        trigger.changeSource("macos.fileChanges")
        trigger.source.folder = "/tmp/inbox"
        trigger.syncDefaultName(from: before)
        #expect(trigger.name == "New files in inbox")
        let named = trigger
        trigger.source.runPerFile = true
        trigger.syncDefaultName(from: named)
        #expect(trigger.name == "New files in inbox, one run each")
        trigger.name = "Screenshots"
        let custom = trigger
        trigger.source.runPerFile = false
        trigger.syncDefaultName(from: custom)
        #expect(trigger.name == "Screenshots")
        #expect(trigger.hasCustomName)
    }
}
