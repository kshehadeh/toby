import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("ChangelogView")
struct ChangelogViewTests {
	private func makeStore(
		changelog: ChangelogResponse? = nil,
		isLoading: Bool = false,
		errorMessage: String? = nil
	) -> ChangelogStore {
		let store = ChangelogStore(client: MockChangelogClient(), cacheInterval: 600)
		store.changelog = changelog
		store.isLoading = isLoading
		store.errorMessage = errorMessage
		return store
	}

	private func makeRelease() -> ChangelogRelease {
		ChangelogRelease(
			version: "0.53.3",
			tagName: "v0.53.3",
			url: "https://example.com",
			publishedAt: "2026-06-21T07:33:33Z",
			features: [ChangelogChange(type: "feat", scope: "app", description: "New feature", sha: nil)],
			bugs: [],
			enhancements: []
		)
	}

	@Test("shows loading skeleton when no changelog is loaded")
	func showsSkeletonWhenLoading() throws {
		let store = makeStore(isLoading: true)
		let view = ChangelogView(store: store, updateStore: nil)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "changelog-skeleton")
		}
	}

	@Test("shows release version when changelog is loaded")
	func showsLoadedReleases() throws {
		let store = makeStore(changelog: ChangelogResponse(releases: [makeRelease()]))
		let view = ChangelogView(store: store, updateStore: nil)
		#expect(throws: Never.self) { try view.inspect().find(text: "0.53.3") }
	}

	@Test("shows error message when loading fails")
	func showsErrorMessage() throws {
		let store = makeStore(errorMessage: "Network error")
		let view = ChangelogView(store: store, updateStore: nil)
		#expect(throws: Never.self) { try view.inspect().find(text: "Network error") }
	}

	@Test("shows empty state when no releases exist")
	func showsEmptyState() throws {
		let store = makeStore(changelog: ChangelogResponse(releases: []))
		let view = ChangelogView(store: store, updateStore: nil)
		#expect(throws: Never.self) { try view.inspect().find(text: "No recent changes available.") }
	}
}
