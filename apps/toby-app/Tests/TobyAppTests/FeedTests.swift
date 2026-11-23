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
				{ "id": "snooze", "label": "Snooze until tomorrow", "kind": "local" },
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

	@Test("chat, open, and tool actions are calls to action; snooze is split from the menu state actions")
	func performableActions() throws {
		let feed = try decodeFeed()
		let email = try #require(feed.items.first { $0.source.category == "email" })
		#expect(email.performableActions.map(\.id) == ["email.draftReply", "todo.add"])
		#expect(email.stateActions.map(\.id) == ["snooze", "dismiss"])
		#expect(email.snoozeAction?.id == "snooze")
		#expect(email.menuStateActions.map(\.id) == ["dismiss"])
		#expect(email.performableActions.map(\.runsInDaemon) == [false, true])
		#expect(email.canDismiss)
		#expect(email.systemImage == "envelope")
		let event = try #require(feed.items.first { $0.source.category == "calendar" })
		#expect(event.performableActions.map(\.id) == ["calendar.prep", "open"])
	}

	@Test("store hides an item while its action runs and adopts the daemon's feed")
	func storeActionSuccess() async throws {
		let payload = try decodeFeed()
		var calls: [String] = []
		let store = FeedStore(
			fetch: { _ in payload },
			perform: { itemID, actionID in
				calls.append("\(itemID)|\(actionID)")
				let remaining = payload.items.filter { $0.id != itemID }
				return FeedActionResponse(
					ok: true,
					message: "Added to your todos.",
					content: FeedContent(status: .ok, items: remaining, generatedAt: payload.generatedAt)
				)
			}
		)
		await store.update(force: false)
		let email = try #require(store.content?.items.first { $0.source.category == "email" })
		let addTodo = try #require(email.actions.first { $0.id == "todo.add" })
		let outcome = await store.perform(addTodo, on: email)
		#expect(outcome == .success("Added to your todos."))
		#expect(calls == ["email:email:42|todo.add"])
		#expect(store.groupedItems.map(\.tier) == [.now])
		#expect(store.busyIDs.isEmpty)

		// A later refresh that no longer lists the item keeps it gone.
		await store.update(force: true)
		#expect(store.hiddenIDs.isEmpty)
	}

	@Test("store restores an item when its action fails")
	func storeActionFailure() async throws {
		struct Boom: LocalizedError { var errorDescription: String? { "IMAP is down" } }
		let payload = try decodeFeed()
		let store = FeedStore(fetch: { _ in payload }, perform: { _, _ in throw Boom() })
		await store.update(force: false)
		let event = try #require(store.content?.items.first { $0.tier == .now })
		let dismiss = try #require(event.actions.first { $0.isDismiss })
		let outcome = await store.perform(dismiss, on: event)
		#expect(outcome == .failure("IMAP is down"))
		#expect(store.groupedItems.map(\.tier) == [.now, .today])
	}

	@Test("store reloads the Feed after a failed action so a stale list is replaced")
	func storeReloadsAfterFailure() async throws {
		struct Gone: LocalizedError { var errorDescription: String? { "gone" } }
		let payload = try decodeFeed()
		var fetches = 0
		let store = FeedStore(fetch: { _ in
			fetches += 1
			return payload
		}, perform: { _, _ in throw Gone() })
		await store.update(force: false)
		let event = try #require(store.content?.items.first { $0.tier == .now })
		let dismiss = try #require(event.actions.first { $0.isDismiss })
		_ = await store.perform(dismiss, on: event)
		#expect(fetches == 2)
	}

	@Test("store refuses client-side actions")
	func storeRejectsChatActions() async throws {
		let payload = try decodeFeed()
		var called = false
		let store = FeedStore(fetch: { _ in payload }, perform: { _, _ in
			called = true
			return FeedActionResponse(ok: true)
		})
		await store.update(force: false)
		let email = try #require(store.content?.items.first { $0.source.category == "email" })
		let reply = try #require(email.actions.first { $0.id == "email.draftReply" })
		if case .success = await store.perform(reply, on: email) { Issue.record("chat action ran in daemon") }
		#expect(!called)
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

	@Test("row shows the primary actions and snooze as buttons, dismiss in the menu")
	func rowActions() throws {
		let feed = try decodeFeed()
		let email = try #require(feed.items.first { $0.source.category == "email" })
		var performed: [String] = []
		let row = FeedItemRow(item: email, onPerform: { performed.append($0.id) })
		try row.inspect().find(button: "Add to my todo list").tap()
		try row.inspect().find(button: "Snooze").tap()
		try row.inspect().find(button: "Dismiss").tap()
		#expect(performed == ["todo.add", "snooze", "dismiss"])
	}

	@Test("source line names the connection, then the sender or list")
	func sourceLine() throws {
		let feed = try decodeFeed()
		let email = try #require(feed.items.first { $0.source.category == "email" })
		#expect(email.sourceName == "Email")
		#expect(email.sourceLine == "Email · alex@example.com")

		let task = FeedItem(
			id: "tasks:applereminders:r1",
			source: FeedItemSource(
				category: "tasks",
				providerName: "applereminders",
				providerDisplayName: "Apple Reminders",
				itemId: "r1"
			),
			tier: .today,
			title: "Call the bank",
			reason: "High priority.",
			actions: []
		)
		#expect(task.sourceLine == "Apple Reminders")
		#expect(throws: Never.self) {
			try FeedItemRow(item: task, onPerform: { _ in }).inspect().find(text: "Apple Reminders")
		}
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
}

extension FeedTests {
	@Test func olderResponseCannotUndoDismissal() async throws {
		var first = try decodeFeed()
		first.generation = 1
		let store = FeedStore(fetch: { _ in first }, perform: { id, _ in
			FeedActionResponse(ok: true, content: FeedContent(status: .ok, items: first.items.filter { $0.id != id }, generatedAt: first.generatedAt, generation: 2))
		})
		await store.update(force: false)
		let item = try #require(first.items.first)
		await store.dismiss(item)
		await store.update(force: true)
		#expect(store.content?.generation == 2)
		#expect(store.content?.items.contains { $0.id == item.id } == false)
	}
}
