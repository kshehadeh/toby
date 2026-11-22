import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("Follow-ups settings")
struct FollowupsSettingsTests {
	@Test("inspector lookup errors offer recovery instead of hiding the failure")
	func inspectorLookupError() throws {
		let store = FollowupTodoDetailStore()
		store.lookupError = "The daemon is unavailable."
		let todo = TobyTodo(
			id: "todo-1", revision: "r1", title: "Reply", description: "", priority: "none",
			listId: "inbox", projectId: nil, projectLabel: nil, tags: [], due: nil,
			recurrence: nil, deleted: false, occurrenceId: "todo-1:0", sequence: 0,
			state: TodoOccurrenceState(status: "open", at: nil), checklist: [], reminders: []
		)
		let view = FollowupTodoSection(store: store, todo: todo)
		#expect(throws: Never.self) { try view.inspect().find(text: "Follow-up explanation unavailable") }
		#expect(throws: Never.self) { try view.inspect().find(button: "Try again") }
	}

	@Test("partial API config fills defaults and exposes custom values")
	func decodesPartialConfiguration() throws {
		let response = try JSONDecoder().decode(
			FollowupsSettingsResponse.self,
			from: Data(#"{"followups":{"sources":{"plugin:email":false},"kinds":{"oweReply":false},"thresholds":{"close":0.9},"evaluator":{"provider":"openai","model":"gpt-4.1-mini"}}}"#.utf8)
		)
		#expect(response.followups.enabled)
		#expect(!response.followups.kinds.oweReply)
		#expect(response.followups.kinds.awaitingReply)
		#expect(response.followups.kinds.commitment)
		#expect(response.followups.thresholds.open == 0.75)
		#expect(response.followups.thresholds.close == 0.9)
		#expect(response.followups.awaitingReplyDays == 3)
		#expect(response.followups.evaluator?.provider == "openai")
		#expect(response.followups.evaluator?.model == "gpt-4.1-mini")
	}

	@Test("manual run response preserves result counts and setup errors")
	func decodesManualRunResult() throws {
		let result = try JSONDecoder().decode(
			FollowupsRunResult.self,
			from: Data(#"{"status":"ok","ingested":3,"enriched":2,"reconciled":1,"candidates":4,"evaluated":3,"opened":1,"closed":2}"#.utf8)
		)
		#expect(result.evaluated == 3)
		#expect(result.opened == 1)
		#expect(result.closed == 2)
		#expect(result.error == nil)
	}

	@Test("request body persists only source overrides and can clear evaluator")
	func requestBodyCompactsDefaults() throws {
		var config = FollowupsSettingsConfig()
		config.sources = ["calendar": true, "plugin:email": false]
		config.evaluator = nil
		let body = config.requestBody(sourceDefaults: ["calendar": true, "plugin:email": true])
		let data = try JSONSerialization.data(withJSONObject: body)
		let root = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
		let followups = try #require(root["followups"] as? [String: Any])
		let sources = try #require(followups["sources"] as? [String: Bool])
		#expect(sources == ["plugin:email": false])
		let evaluator = try #require(followups["evaluator"] as? [String: Any])
		#expect(evaluator["provider"] is NSNull)
		#expect(evaluator["model"] is NSNull)
	}

	@Test("settings show sources and manual check")
	func settingsRenderSourceControls() throws {
		let store = FollowupsSettingsStore()
		store.hasLoaded = true
		store.sources = [
			FollowupSource(
				id: "calendar",
				displayName: "Calendar",
				origin: "core",
				evidenceOnly: false,
				enabled: true,
				defaultEnabled: true,
				cursor: nil
			),
		]
		store.configuration.sources = ["calendar": true]
		store.savedConfiguration = store.configuration
		store.providers = [
			AIProviderInfo(
				providerId: "openai",
				displayName: "OpenAI",
				models: [AIModelOption(id: "gpt-4.1-mini", structuredOutput: true)],
				allowCustomModel: false,
				configured: true
			),
		]
		store.instructions = [
			FollowupInstruction(id: "instruction-1", text: "Prioritize direct requests", updatedAt: nil),
		]
		store.instructionDrafts = ["instruction-1": "Prioritize direct requests"]

		let view = FollowupsSettingsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "followups-settings-form")
		}
		#expect(throws: Never.self) { try view.inspect().find(text: "Calendar") }
		#expect(throws: Never.self) { try view.inspect().find(text: "OpenAI · gpt-4.1-mini") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Prioritize direct requests") }
		#expect(throws: Never.self) { try view.inspect().find(button: "Check now") }
		#expect(!store.hasUnsavedChanges)
	}

	@Test("follow-up inspector explains evidence and exposes undo")
	func inspectorActions() throws {
		let todo = TobyTodo(
			id: "todo-1",
			revision: "r1",
			title: "Reply to Dana",
			description: "",
			priority: "none",
			listId: "from-toby",
			projectId: nil,
			projectLabel: nil,
			tags: [],
			due: nil,
			recurrence: nil,
			deleted: false,
			occurrenceId: "todo-1:0",
			sequence: 0,
			state: TodoOccurrenceState(status: "completed", at: nil),
			checklist: [],
			reminders: []
		)
		let store = FollowupTodoDetailStore()
		store.detail = FollowupDetail(
			loopId: "loop-1",
			kind: "owe_reply",
			status: "resolved",
			fingerprint: "fingerprint",
			title: "Reply to Dana",
			counterpart: "Dana",
			dueAt: nil,
			confidence: 0.92,
			todoId: todo.id,
			resolutionRejected: false,
			reopenedAt: nil,
			lastActivityAt: "2027-01-02T10:00:00.000Z",
			createdAt: "2027-01-01T10:00:00.000Z",
			updatedAt: "2027-01-02T10:00:00.000Z",
			evidence: [FollowupEvidence(
				id: "email-node",
				reason: "A direct question needs a reply.",
				title: "Can you review the deck?",
				occurredAt: "2027-01-01T09:00:00.000Z",
				url: "https://mail.example/thread-1"
			)]
		)

		let view = FollowupTodoSection(store: store, todo: todo)
		#expect(throws: Never.self) { try view.inspect().find(text: "Why Toby added this") }
		#expect(throws: Never.self) { try view.inspect().find(text: "A direct question needs a reply.") }
		#expect(throws: Never.self) { try view.inspect().find(button: "Reopen") }
		#expect(throws: Never.self) { try view.inspect().find(button: "Not useful") }
	}
}
