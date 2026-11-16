import Foundation
import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

private let feedJSON = """
{
	"status": "ok",
	"generatedAt": "2026-11-16T15:00:00Z",
	"personaName": "Home",
	"model": { "provider": "openrouter", "model": "openai/gpt-5-mini" },
	"sources": [{ "providerName": "email", "providerDisplayName": "Email" }],
	"items": [
		{
			"id": "email:email:42",
			"source": { "category": "email", "providerName": "email", "itemId": "42" },
			"tier": "today",
			"title": "Contract review",
			"subtitle": "alex@example.com",
			"reason": "Alex asked for your sign-off by Friday.",
			"timestamp": "2026-11-16T14:00:00Z",
			"actions": [
				{ "id": "email.draftReply", "label": "Draft a reply", "kind": "chat", "prompt": "Draft a reply to 42" },
				{ "id": "todo.add", "label": "Add to my todo list", "kind": "tool" },
				{ "id": "dismiss", "label": "Dismiss", "kind": "local" }
			]
		},
		{
			"id": "calendar:applecalendar:e1",
			"source": { "category": "calendar", "providerName": "applecalendar", "itemId": "e1", "url": "ical://e1" },
			"tier": "now",
			"title": "1:1 with Sam",
			"reason": "Starts in 20 minutes.",
			"actions": [
				{ "id": "calendar.prep", "label": "Prep for this meeting", "kind": "chat", "prompt": "Prep e1" },
				{ "id": "open", "label": "Open", "kind": "open", "url": "ical://e1" },
				{ "id": "dismiss", "label": "Dismiss", "kind": "local" }
			]
		}
	]
}
"""

private func decodeFeed(_ json: String = feedJSON) throws -> FeedContent {
	try JSONDecoder().decode(FeedContent.self, from: Data(json.utf8))
}

private func setupFeed() -> FeedContent {
	FeedContent(
		status: .setupRequired,
		items: [],
		generatedAt: "2026-11-16T15:00:00Z",
		setupReason: "Choose a Feed model that supports structured output in Settings → Home."
	)
}

@MainActor
@Suite("The Feed")
struct FeedTests {
	@Test("feed payload decodes and groups by tier in tier order")
	func decodesAndGroups() throws {
		let feed = try decodeFeed()
		#expect(feed.status == .ok)
		#expect(feed.model?.model == "openai/gpt-5-mini")
		let groups = feed.groupedItems()
		#expect(groups.map(\.tier) == [.now, .today])
		#expect(groups.first?.items.first?.title == "1:1 with Sam")
		#expect(feed.groupedItems(excluding: ["calendar:applecalendar:e1"]).map(\.tier) == [.today])
	}

	@Test("only chat and open actions are performable; tool and dismiss are not")
	func performableActions() throws {
		let feed = try decodeFeed()
		let email = try #require(feed.items.first { $0.source.category == "email" })
		#expect(email.performableActions.map(\.id) == ["email.draftReply"])
		#expect(email.canDismiss)
		#expect(email.systemImage == "envelope")
		let event = try #require(feed.items.first { $0.source.category == "calendar" })
		#expect(event.performableActions.map(\.id) == ["calendar.prep", "open"])
	}

	@Test("store loads, dismisses for the session, and forgets dismissals for vanished items")
	func storeDismissal() async throws {
		var payload = try decodeFeed()
		var forcedCalls: [Bool] = []
		let store = FeedStore { fresh in
			forcedCalls.append(fresh)
			return payload
		}
		await store.update(force: false)
		#expect(store.groupedItems.flatMap(\.items).count == 2)

		let event = try #require(store.content?.items.first { $0.tier == .now })
		store.dismiss(event)
		#expect(store.groupedItems.map(\.tier) == [.today])

		payload = try decodeFeed(feedJSON.replacingOccurrences(of: "calendar:applecalendar:e1", with: "calendar:applecalendar:e2"))
		await store.update(force: true)
		#expect(store.dismissedIDs.isEmpty)
		#expect(store.groupedItems.map(\.tier) == [.now, .today])
		#expect(forcedCalls == [false, true])
	}

	@Test("store keeps the last feed when a refresh fails")
	func storeKeepsContentOnError() async throws {
		struct Boom: Error {}
		var fail = false
		let payload = try decodeFeed()
		let store = FeedStore { _ in
			if fail { throw Boom() }
			return payload
		}
		await store.update(force: false)
		fail = true
		await store.update(force: true)
		#expect(store.content == payload)
		#expect(store.error != nil)
	}

	@Test("card renders tiers, reasons, and the primary action, and runs it")
	func cardRendersItems() async throws {
		let store = FeedStore { _ in try decodeFeed() }
		await store.update(force: false)
		var performed: [String] = []
		let card = FeedCardBody(store: store, onPerform: { performed.append($0.id) })
		// FeedCardBody, not FeedCardView: ViewInspector crashes walking
		// `CardHeader` on the current toolchain (pre-existing; also affects
		// DashboardBlockCard tests).
		let inspected = try card.inspect()
		#expect(throws: Never.self) { try inspected.find(text: "NOW") }
		#expect(throws: Never.self) { try inspected.find(text: "Alex asked for your sign-off by Friday.") }
		try inspected.find(button: "Draft a reply").tap()
		#expect(performed == ["email.draftReply"])
	}

	@Test("row shows chat/open actions but not unwired tool actions")
	func rowHidesToolActions() throws {
		let feed = try decodeFeed()
		let email = try #require(feed.items.first { $0.source.category == "email" })
		var dismissed = false
		let row = FeedItemRow(item: email, onPerform: { _ in }, onDismiss: { dismissed = true })
		#expect(throws: Never.self) { try row.inspect().find(button: "Draft a reply") }
		#expect(throws: (any Error).self) { try row.inspect().find(button: "Add to my todo list") }
		try row.inspect().find(button: "Dismiss").tap()
		#expect(dismissed)
	}

	@Test("setup state explains the model requirement and links to settings")
	func cardSetupState() async throws {
		let store = FeedStore { _ in setupFeed() }
		await store.update(force: false)
		var opened = false
		let card = FeedCardBody(store: store, onOpenSettings: { opened = true })
		let inspected = try card.inspect()
		#expect(throws: Never.self) {
			try inspected.find(text: "Choose a Feed model that supports structured output in Settings → Home.")
		}
		try inspected.find(button: "Choose a Feed model").tap()
		#expect(opened)
	}

	@Test("empty ok feed shows the all-clear message")
	func cardEmptyState() async throws {
		let store = FeedStore { _ in
			FeedContent(status: .ok, items: [], generatedAt: "2026-11-16T15:00:00Z")
		}
		await store.update(force: false)
		let card = FeedCardBody(store: store)
		#expect(throws: Never.self) {
			try card.inspect().find(text: "Nothing needs your attention right now.")
		}
	}

	@Test("show feed preference defaults on and persists")
	func showFeedPreference() {
		let defaults = UserDefaults(suiteName: "FeedTests-\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: defaults, applyLaunchAtLoginOnChange: false)
		#expect(prefs.showFeed)
		prefs.showFeed = false
		let reloaded = AppearancePreferences(defaults: defaults, applyLaunchAtLoginOnChange: false)
		#expect(!reloaded.showFeed)
	}
}
