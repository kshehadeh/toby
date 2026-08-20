import Testing
@testable import TobyApp

@MainActor
@Suite("ConfigureStore auth fields")
struct ConfigureStoreAuthFieldsTests {
	private func field(
		key: String,
		label: String,
		kind: SettingsItemKind = .value,
		options: [String]? = nil,
		currentValue: String? = nil,
		showForAuthMethods: [String]? = nil,
		showForInbound: Bool? = nil
	) -> SettingsItem {
		SettingsItem(
			label: label,
			kind: kind,
			key: key,
			navKey: key,
			children: nil,
			masked: nil,
			multiline: nil,
			options: options,
			selectChoices: nil,
			currentValue: currentValue,
			selectedValues: nil,
			readOnly: nil,
			showForAuthMethods: showForAuthMethods,
			showForInbound: showForInbound
		)
	}

	private func section(
		key: String,
		label: String,
		children: [SettingsItem]
	) -> SettingsItem {
		SettingsItem(
			label: label,
			kind: .section,
			key: key,
			navKey: key,
			children: children,
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil
		)
	}

	private func slackSection() -> SettingsItem {
		section(key: "slack", label: "Slack", children: [
			field(
				key: "slack.authMethod",
				label: "Auth Method",
				kind: .select,
				options: ["oauth", "bot_token"],
				currentValue: "oauth"
			),
			field(key: "slack.clientId", label: "OAuth Client ID", showForAuthMethods: ["oauth"]),
			field(key: "slack.clientSecret", label: "OAuth Client Secret", showForAuthMethods: ["oauth"]),
			field(
				key: "slack.botToken",
				label: "Bot Token",
				showForAuthMethods: ["bot_token"],
				showForInbound: true
			),
			field(key: "slack.appToken", label: "App Token"),
		])
	}

	private func jiraSection() -> SettingsItem {
		section(key: "jira", label: "Jira", children: [
			field(
				key: "jira.authMethod",
				label: "Auth Method",
				kind: .select,
				options: ["oauth", "api_token"],
				currentValue: "oauth"
			),
			field(key: "jira.clientId", label: "OAuth Client ID", showForAuthMethods: ["oauth"]),
			field(key: "jira.domain", label: "Atlassian Domain", showForAuthMethods: ["api_token"]),
			field(key: "jira.apiToken", label: "API Token", showForAuthMethods: ["api_token"]),
		])
	}

	private func keys(in store: ConfigureStore, section: SettingsItem) -> [String] {
		store.detailFields(for: section).map(\.key)
	}

	@Test("Slack oauth default shows oauth fields and hides bot token")
	func slackOauthDefaultHidesBotToken() {
		let store = ConfigureStore()
		let section = slackSection()
		let visible = keys(in: store, section: section)
		#expect(visible.contains("slack.authMethod"))
		#expect(visible.contains("slack.clientId"))
		#expect(visible.contains("slack.clientSecret"))
		#expect(visible.contains("slack.appToken"))
		#expect(!visible.contains("slack.botToken"))
	}

	@Test("switching Slack auth method to bot token updates visible fields immediately")
	func slackAuthMethodSwitchUpdatesFields() {
		let store = ConfigureStore()
		let section = slackSection()
		store.setDraftValue("slack.authMethod", "bot_token")
		let visible = keys(in: store, section: section)
		#expect(visible.contains("slack.botToken"))
		#expect(visible.contains("slack.appToken"))
		#expect(!visible.contains("slack.clientId"))
		#expect(!visible.contains("slack.clientSecret"))
	}

	@Test("Slack inbound on shows bot token even for oauth")
	func slackInboundShowsBotTokenForOauth() {
		let store = ConfigureStore()
		let section = slackSection()
		store.setDraftValue("slack.authMethod", "oauth")
		store.setDraftValue("slack.inboundEnabled", "true")
		let visible = keys(in: store, section: section)
		#expect(visible.contains("slack.clientId"))
		#expect(visible.contains("slack.botToken"))
	}

	@Test("switching Jira auth method to api token updates visible fields immediately")
	func jiraAuthMethodSwitchUpdatesFields() {
		let store = ConfigureStore()
		let section = jiraSection()
		#expect(keys(in: store, section: section).contains("jira.clientId"))
		#expect(!keys(in: store, section: section).contains("jira.apiToken"))

		store.setDraftValue("jira.authMethod", "api_token")
		let visible = keys(in: store, section: section)
		#expect(visible.contains("jira.domain"))
		#expect(visible.contains("jira.apiToken"))
		#expect(!visible.contains("jira.clientId"))
	}

	@Test("decodes showForAuthMethods from configure JSON")
	func decodesShowForAuthMethods() throws {
		let json = """
		{
			"label": "Bot Token",
			"kind": "value",
			"key": "slack.botToken",
			"showForAuthMethods": ["bot_token"],
			"showForInbound": true
		}
		"""
		let data = try #require(json.data(using: .utf8))
		let item = try JSONDecoder().decode(SettingsItem.self, from: data)
		#expect(item.showForAuthMethods == ["bot_token"])
		#expect(item.showForInbound == true)
	}
}
