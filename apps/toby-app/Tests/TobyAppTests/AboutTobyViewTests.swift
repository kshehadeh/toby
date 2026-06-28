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

	private func makePluginsStore() -> PluginsStore {
		let store = PluginsStore(client: MockPluginsClient())
		store.pluginsDirectory = "/Users/example/.toby/plugins"
		store.plugins = [
			PluginSummary(
				name: "slack",
				displayName: "Slack",
				description: nil,
				version: "1.2.0",
				protocolVersion: "1",
				state: "valid",
				connected: true,
				error: nil,
				errorCode: nil
			),
		]
		return store
	}

	@Test("shows app name and version")
	func showsAppIdentity() throws {
		let view = AboutTobyView(
			changelogStore: makeChangelogStore(),
			updateStore: nil,
			pluginsStore: makePluginsStore(),
			appVersion: "0.66.0"
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Toby") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Version 0.66.0") }
	}

	@Test("shows plugins section with plugin display name")
	func showsPlugins() throws {
		let view = AboutTobyView(
			changelogStore: makeChangelogStore(),
			updateStore: nil,
			pluginsStore: makePluginsStore(),
			appVersion: "0.66.0"
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Plugins") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Slack") }
	}

	@Test("shows plugin directory as reveal-in-finder button")
	func showsPluginDirectory() throws {
		let view = AboutTobyView(
			changelogStore: makeChangelogStore(),
			updateStore: nil,
			pluginsStore: makePluginsStore(),
			appVersion: "0.66.0"
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Plugin directory") }
		#expect(throws: Never.self) { try view.inspect().find(text: "/Users/example/.toby/plugins") }
		// The path itself is the clickable button with a "Reveal in Finder" accessibility label.
		let buttons = try view.inspect().findAll(ViewType.Button.self)
		let revealButtons = buttons.filter { btn in
			(try? btn.accessibilityLabel().string()) == "Reveal in Finder"
		}
		#expect(revealButtons.count == 1)
		#expect((try? revealButtons.first?.accessibilityValue().string()) == "/Users/example/.toby/plugins")
	}

	@Test("shows open source libraries section")
	func showsOpenSourceSection() throws {
		let view = AboutTobyView(
			changelogStore: makeChangelogStore(),
			updateStore: nil,
			pluginsStore: makePluginsStore(),
			appVersion: "0.66.0"
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Open Source Libraries") }
	}

	@Test("shows changelog column header and release version")
	func showsChangelogColumn() throws {
		let view = AboutTobyView(
			changelogStore: makeChangelogStore(),
			updateStore: nil,
			pluginsStore: makePluginsStore(),
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
			pluginsStore: makePluginsStore(),
			appVersion: "0.66.0"
		)
		#expect(throws: Never.self) { try view.inspect().find(button: "Done") }
	}
}
