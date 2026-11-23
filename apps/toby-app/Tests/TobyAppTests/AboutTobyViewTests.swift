import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("AboutTobyView")
struct AboutTobyViewTests {
	private func makeChangelogStore() -> ChangelogStore {
		let store = ChangelogStore(client: MockChangelogClient(), cacheInterval: 600)
		store.changelog = ChangelogResponse(releases: [
			ChangelogRelease(
				version: "0.66.0",
				tagName: "v0.66.0",
				url: "https://example.com",
				publishedAt: "2026-06-21T07:33:33Z",
				features: [ChangelogChange(type: "feat", scope: "app", description: "New feature", sha: nil)],
				bugs: [],
				enhancements: []
			),
		])
		return store
	}

	@Test("shows app name and version")
	func showsAppIdentity() throws {
		let view = AboutTobyView(
			changelogStore: makeChangelogStore(),
			updateStore: nil,
			appVersion: "0.66.0"
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Toby") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Version 0.66.0") }
	}

	@Test("shows the home directory")
	func showsHomeDirectory() throws {
		let view = AboutTobyView(
			changelogStore: makeChangelogStore(),
			updateStore: nil,
			appVersion: "0.66.0",
			tobyDirectory: "/Users/example/.toby"
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Toby home directory") }
		#expect(throws: Never.self) { try view.inspect().find(text: "/Users/example/.toby") }
	}

	@Test("shows open source libraries section")
	func showsOpenSourceSection() throws {
		let view = AboutTobyView(
			changelogStore: makeChangelogStore(),
			updateStore: nil,
			appVersion: "0.66.0"
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Open Source Libraries") }
		#expect(throws: Never.self) { try view.inspect().find(text: "GRDB.swift") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Sparkle") }
	}

	@Test("shows changelog column header and release version")
	func showsChangelogColumn() throws {
		let view = AboutTobyView(
			changelogStore: makeChangelogStore(),
			updateStore: nil,
			appVersion: "0.66.0"
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "What's New") }
		#expect(throws: Never.self) { try view.inspect().find(text: "0.66.0") }
	}

	@Test("shows Done button")
	func showsDoneButton() throws {
		let view = AboutTobyView(
			changelogStore: makeChangelogStore(),
			updateStore: nil,
			appVersion: "0.66.0"
		)
		#expect(throws: Never.self) { try view.inspect().find(button: "Done") }
	}
}
