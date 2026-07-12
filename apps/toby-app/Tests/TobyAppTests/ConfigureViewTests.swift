import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("ConfigureView")
struct ConfigureViewTests {
	@Test("configure view renders detail content")
	func configureViewRendersDetailContent() throws {
		let store = ConfigureStore()
		let view = ConfigureView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(ConfigureDetailView.self) }
	}

	@Test("configure detail shows placeholder when no section selected")
	func configureDetailShowsPlaceholder() throws {
		let store = ConfigureStore()
		store.settingsSections = [
			SettingsItem(
				label: "Chat", kind: .section, key: "chatInbound",
				navKey: nil, children: [],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
		]
		let view = ConfigureView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Select a section")
		}
	}

	@Test("configure detail renders selected section label")
	func configureDetailRendersSelectedSection() throws {
		let store = ConfigureStore()
		store.settingsSections = [
			SettingsItem(
				label: "AI", kind: .section, key: "ai",
				navKey: nil, children: [
					SettingsItem(
						label: "OpenAI", kind: .section, key: "ai.openai",
						navKey: "ai.openai", children: [],
						masked: nil, multiline: nil, options: nil, selectChoices: nil,
						currentValue: nil, selectedValues: nil, readOnly: nil
					),
				],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
		]
		store.selectedSectionDetail = SettingsItem(
			label: "OpenAI", kind: .section, key: "ai.openai",
			navKey: "ai.openai", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		store.selectedNavKey = "ai.openai"

		let view = ConfigureView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "OpenAI")
		}
	}

	@Test("settings sidebar tree is built from settingsSections")
	func settingsSidebarTreeFromSections() throws {
		let store = ConfigureStore()
		store.settingsSections = [
			SettingsItem(
				label: "Chat", kind: .section, key: "chatInbound",
				navKey: nil, children: [],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
			SettingsItem(
				label: "Default Providers", kind: .section, key: "defaults",
				navKey: nil, children: [],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
			SettingsItem(
				label: "AI", kind: .section, key: "ai",
				navKey: nil, children: [
					SettingsItem(
						label: "OpenAI", kind: .section, key: "ai.openai",
						navKey: "ai.openai", children: [],
						masked: nil, multiline: nil, options: nil, selectChoices: nil,
						currentValue: nil, selectedValues: nil, readOnly: nil
					),
				],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
			SettingsItem(
				label: "Projects", kind: .section, key: "projects",
				navKey: nil, children: [],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
		]
		let tree = store.settingsSidebarTree
		#expect(tree.count == 4)
		#expect(tree[0].item.key == "chatInbound")
		#expect(tree[1].item.key == "defaults")
		#expect(tree[2].item.key == "ai")
		#expect(tree[3].item.key == "projects")
		// AI should have one child section (OpenAI)
		#expect(tree[2].children.count == 1)
		#expect(tree[2].children[0].item.key == "ai.openai")
	}

	@Test("isSettingsMode is true when settingsSections is populated")
	func isSettingsModeTrueWhenSectionsPopulated() throws {
		let store = ConfigureStore()
		#expect(store.isSettingsMode == false)
		store.settingsSections = [
			SettingsItem(
				label: "Chat", kind: .section, key: "chatInbound",
				navKey: nil, children: [],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
		]
		#expect(store.isSettingsMode == true)
	}

	@Test("AI hierarchy sidebar lists providers")
	func aiHierarchySidebarListsProviders() throws {
		let store = ConfigureStore()
		let aiSection = SettingsItem(
			label: "AI", kind: .section, key: "ai",
			navKey: nil, children: [
				SettingsItem(
					label: "OpenAI", kind: .section, key: "ai.openai",
					navKey: "ai.openai", children: [],
					masked: nil, multiline: nil, options: nil, selectChoices: nil,
					currentValue: nil, selectedValues: nil, readOnly: nil,
					iconUrl: "/icons/ai/openai.png",
					description: "Use OpenAI models like GPT-5, GPT-4o, and o3 directly.",
					docUrl: "https://openai.com/api/"
				),
				SettingsItem(
					label: "Ollama", kind: .section, key: "ai.ollama",
					navKey: "ai.ollama", children: [],
					masked: nil, multiline: nil, options: nil, selectChoices: nil,
					currentValue: nil, selectedValues: nil, readOnly: nil,
					iconUrl: "/icons/ai/ollama.png",
					description: "Run open-source models locally.",
					docUrl: "https://docs.ollama.com/quickstart"
				),
			],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		store.settingsSections = [aiSection]
		store.selectedNavKey = "ai.openai"

		let view = SettingsHierarchySidebarView(store: store, parent: aiSection)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "OpenAI")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Ollama")
		}
		#expect(ConfigureTreeHelpers.hasNestedSections(aiSection))
	}

	@Test("selectTopLevelTab on AI selects first provider child")
	func selectTopLevelTabSelectsFirstAIChild() throws {
		let store = ConfigureStore()
		store.settingsSections = [
			SettingsItem(
				label: "AI", kind: .section, key: "ai",
				navKey: nil, children: [
					SettingsItem(
						label: "OpenAI", kind: .section, key: "ai.openai",
						navKey: "ai.openai", children: [],
						masked: nil, multiline: nil, options: nil, selectChoices: nil,
						currentValue: nil, selectedValues: nil, readOnly: nil
					),
					SettingsItem(
						label: "Ollama", kind: .section, key: "ai.ollama",
						navKey: "ai.ollama", children: [],
						masked: nil, multiline: nil, options: nil, selectChoices: nil,
						currentValue: nil, selectedValues: nil, readOnly: nil
					),
				],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
		]
		store.selectTopLevelTab("ai")
		#expect(store.selectedNavKey == "ai.openai")
		#expect(store.selectedTopLevelKey == "ai")
	}

	@Test("settings window renders top-level section labels")
	func settingsWindowRendersTopLevelLabels() throws {
		let store = ConfigureStore()
		store.settingsSections = [
			SettingsItem(
				label: "Chat", kind: .section, key: "chatInbound",
				navKey: nil, children: [],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
			SettingsItem(
				label: "AI", kind: .section, key: "ai",
				navKey: nil, children: [
					SettingsItem(
						label: "OpenAI", kind: .section, key: "ai.openai",
						navKey: "ai.openai", children: [],
						masked: nil, multiline: nil, options: nil, selectChoices: nil,
						currentValue: nil, selectedValues: nil, readOnly: nil
					),
				],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
		]
		store.selectedNavKey = "chatInbound"
		store.selectedSectionDetail = SettingsItem(
			label: "Chat", kind: .section, key: "chatInbound",
			navKey: nil, children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)

		let view = SettingsWindowView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-preferences-tab-bar")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Chat")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "AI")
		}
	}

	@Test("settings preferences tab shows icon above text layout")
	func settingsPreferencesTabShowsIconAboveText() throws {
		let bar = SettingsPreferencesTabBar(
			sections: [
				SettingsItem(
					label: "Chat", kind: .section, key: "chatInbound",
					navKey: nil, children: [],
					masked: nil, multiline: nil, options: nil, selectChoices: nil,
					currentValue: nil, selectedValues: nil, readOnly: nil
				),
				SettingsItem(
					label: "Weather", kind: .section, key: "weather",
					navKey: nil, children: [],
					masked: nil, multiline: nil, options: nil, selectChoices: nil,
					currentValue: nil, selectedValues: nil, readOnly: nil
				),
			],
			selectedKey: "chatInbound",
			onSelect: { _ in },
		)
		#expect(throws: Never.self) {
			try bar.inspect().find(text: "Chat")
		}
		#expect(throws: Never.self) {
			try bar.inspect().find(text: "Weather")
		}
	}

	@Test("Default Providers section renders provider cards with dropdowns")
	func defaultProvidersRendersCards() throws {
		let store = ConfigureStore()
		store.settingsSections = [
			SettingsItem(
				label: "Default Providers", kind: .section, key: "defaults",
				navKey: nil, children: [
					SettingsItem(
						label: "Email Provider", kind: .select, key: "defaults.email",
						navKey: nil, children: nil,
						masked: nil, multiline: nil,
						options: ["(none)", "email"], selectChoices: [
							SettingsSelectChoice(value: "(none)", label: "None"),
							SettingsSelectChoice(value: "email", label: "Email"),
						],
						currentValue: "(none)", selectedValues: nil, readOnly: nil,
						description: "Choose which integration handles sending, reading, and organizing your email."
					),
					SettingsItem(
						label: "Task List Provider", kind: .select, key: "defaults.tasks",
						navKey: nil, children: nil,
						masked: nil, multiline: nil,
						options: ["(none)", "todoist"], selectChoices: [
							SettingsSelectChoice(value: "(none)", label: "None"),
							SettingsSelectChoice(value: "todoist", label: "Todoist"),
						],
						currentValue: "todoist", selectedValues: nil, readOnly: nil,
						description: "Choose which integration manages your to-do items and task lists."
					),
					SettingsItem(
						label: "Documents Provider", kind: .select, key: "defaults.documents",
						navKey: nil, children: nil,
						masked: nil, multiline: nil,
						options: ["(none)", "notion"], selectChoices: [
							SettingsSelectChoice(value: "(none)", label: "None"),
							SettingsSelectChoice(value: "notion", label: "Notion"),
						],
						currentValue: "notion", selectedValues: nil, readOnly: nil,
						description: "Choose which integration stores and retrieves contextual documents."
					),
				],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
		]
		store.selectedSectionDetail = SettingsItem(
			label: "Default Providers", kind: .section, key: "defaults",
			navKey: nil, children: [
				SettingsItem(
					label: "Email Provider", kind: .select, key: "defaults.email",
					navKey: nil, children: nil,
					masked: nil, multiline: nil,
					options: ["(none)", "email"], selectChoices: [
						SettingsSelectChoice(value: "(none)", label: "None"),
						SettingsSelectChoice(value: "email", label: "Email"),
					],
					currentValue: "(none)", selectedValues: nil, readOnly: nil,
					description: "Choose which integration handles sending, reading, and organizing your email."
				),
				SettingsItem(
					label: "Task List Provider", kind: .select, key: "defaults.tasks",
					navKey: nil, children: nil,
					masked: nil, multiline: nil,
					options: ["(none)", "todoist"], selectChoices: [
						SettingsSelectChoice(value: "(none)", label: "None"),
						SettingsSelectChoice(value: "todoist", label: "Todoist"),
					],
					currentValue: "todoist", selectedValues: nil, readOnly: nil,
					description: "Choose which integration manages your to-do items and task lists."
				),
				SettingsItem(
					label: "Documents Provider", kind: .select, key: "defaults.documents",
					navKey: nil, children: nil,
					masked: nil, multiline: nil,
					options: ["(none)", "notion"], selectChoices: [
						SettingsSelectChoice(value: "(none)", label: "None"),
						SettingsSelectChoice(value: "notion", label: "Notion"),
					],
					currentValue: "notion", selectedValues: nil, readOnly: nil,
					description: "Choose which integration stores and retrieves contextual documents."
				),
			],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		store.selectedNavKey = "defaults"

		let view = ConfigureView(store: store)
		// Category titles should appear on the cards
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Email Provider")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Task List Provider")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Documents Provider")
		}
		// Description text should appear
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Choose which integration handles sending, reading, and organizing your email.")
		}
		// "Plugin" label should appear next to each dropdown
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Plugin")
		}
	}

	@Test("DefaultProviderIcon maps category keys to SF Symbols")
	func defaultProviderIconMapsKeys() throws {
		#expect(DefaultProviderIcon.systemName(for: "defaults.email") == "envelope")
		#expect(DefaultProviderIcon.systemName(for: "defaults.calendar") == "calendar")
		#expect(DefaultProviderIcon.systemName(for: "defaults.tasks") == "checklist")
		#expect(DefaultProviderIcon.systemName(for: "defaults.contacts") == "person.crop.circle")
		#expect(DefaultProviderIcon.systemName(for: "defaults.chat") == "bubble.left.and.bubble.right")
		#expect(DefaultProviderIcon.systemName(for: "defaults.documents") == "doc.text")
		#expect(DefaultProviderIcon.systemName(for: "defaults.work_tracker") == "chart.bar")
	}

	@Test("SettingsItem decodes iconUrl from JSON")
	func settingsItemDecodesIconUrl() throws {
		let json = """
		{
			"label": "OpenAI",
			"kind": "section",
			"key": "ai.openai",
			"icon": "✨",
			"iconUrl": "/icons/ai/openai.png"
		}
		""".data(using: .utf8)!
		let item = try JSONDecoder().decode(SettingsItem.self, from: json)
		#expect(item.iconUrl == "/icons/ai/openai.png")
		#expect(item.icon == "✨")
	}

	@Test("SettingsItem decodes when iconUrl is absent")
	func settingsItemDecodesWithoutIconUrl() throws {
		let json = """
		{
			"label": "Chat",
			"kind": "section",
			"key": "chatInbound"
		}
		""".data(using: .utf8)!
		let item = try JSONDecoder().decode(SettingsItem.self, from: json)
		#expect(item.iconUrl == nil)
		#expect(item.icon == nil)
	}

	@Test("integration detail header renders image icon URL")
	func integrationDetailHeaderRendersImageIconUrl() throws {
		let store = ConfigureStore()
		let section = SettingsItem(
			label: "Apple Calendar", kind: .section, key: "applecalendar",
			navKey: nil, children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil,
			iconUrl: "/api/plugins/applecalendar/icon"
		)
		let view = IntegrationDetailHeader(
			store: store,
			section: section,
			status: nil,
			isLoading: false,
			isActionLoading: false,
			onAction: { _ in }
		)

		#expect(throws: Never.self) {
			try view.inspect().find(SidebarIconView.self)
		}
	}

	@Test("integration detail header renders emoji fallback")
	func integrationDetailHeaderRendersEmojiFallback() throws {
		let store = ConfigureStore()
		let section = SettingsItem(
			label: "Apple Calendar", kind: .section, key: "applecalendar",
			navKey: nil, children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil,
			iconUrl: nil,
			icon: "📅"
		)
		let view = IntegrationDetailHeader(
			store: store,
			section: section,
			status: nil,
			isLoading: false,
			isActionLoading: false,
			onAction: { _ in }
		)

		#expect(throws: Never.self) {
			try view.inspect().find(text: "📅")
		}
	}

	@Test("settings sidebar uses domain icons for built-in sections")
	func settingsSidebarUsesDomainIconsForBuiltInSections() throws {
		#expect(
			SettingsSidebarIcon.systemName(
				for: SettingsItem(
					label: "Chat", kind: .section, key: "chatInbound",
					navKey: nil, children: nil,
					masked: nil, multiline: nil, options: nil, selectChoices: nil,
					currentValue: nil, selectedValues: nil, readOnly: nil
				)
			) == "bubble.left"
		)
		#expect(
			SettingsSidebarIcon.systemName(
				for: SettingsItem(
					label: "Default Providers", kind: .section, key: "defaults",
					navKey: nil, children: nil,
					masked: nil, multiline: nil, options: nil, selectChoices: nil,
					currentValue: nil, selectedValues: nil, readOnly: nil
				)
			) == "slider.horizontal.3"
		)
		#expect(
			SettingsSidebarIcon.systemName(
				for: SettingsItem(
					label: "AI", kind: .section, key: "ai",
					navKey: nil, children: nil,
					masked: nil, multiline: nil, options: nil, selectChoices: nil,
					currentValue: nil, selectedValues: nil, readOnly: nil
				)
			) == "sparkles"
		)
		#expect(
			SettingsSidebarIcon.systemName(
				for: SettingsItem(
					label: "Transcription", kind: .section, key: "transcription",
					navKey: nil, children: nil,
					masked: nil, multiline: nil, options: nil, selectChoices: nil,
					currentValue: nil, selectedValues: nil, readOnly: nil
				)
			) == "pencil.and.scribble"
		)
		#expect(
			SettingsSidebarIcon.systemName(
				for: SettingsItem(
					label: "Web Search", kind: .section, key: "webSearch",
					navKey: nil, children: nil,
					masked: nil, multiline: nil, options: nil, selectChoices: nil,
					currentValue: nil, selectedValues: nil, readOnly: nil
				)
			) == "magnifyingglass"
		)
		#expect(
			SettingsSidebarIcon.systemName(
				for: SettingsItem(
					label: "Weather", kind: .section, key: "weather",
					navKey: nil, children: nil,
					masked: nil, multiline: nil, options: nil, selectChoices: nil,
					currentValue: nil, selectedValues: nil, readOnly: nil
				)
			) == "cloud.sun"
		)
		#expect(
			SettingsSidebarIcon.systemName(
				for: SettingsItem(
					label: "Dashboard", kind: .section, key: "dashboard",
					navKey: nil, children: nil,
					masked: nil, multiline: nil, options: nil, selectChoices: nil,
					currentValue: nil, selectedValues: nil, readOnly: nil
				)
			) == "rectangle.3.group"
		)
	}

	@Test("configure detail shows skeleton during initial settings load")
	func configureDetailShowsSkeletonWhenLoading() throws {
		let store = ConfigureStore()
		store.isLoading = true
		store.settingsSections = []
		let view = ConfigureView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-detail-skeleton")
		}
	}

	@Test("configure sidebar shows skeleton during initial settings load")
	func configureSidebarShowsSkeletonWhenLoading() throws {
		let store = ConfigureStore()
		store.isLoading = true
		store.settingsSections = []
		let view = ConfigureSidebarView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-sidebar-skeleton")
		}
	}

	@Test("configure detail shows skeleton during section detail loading")
	func configureDetailShowsSkeletonDuringSectionLoad() throws {
		let store = ConfigureStore()
		store.isLoading = false
		store.settingsSections = [
			SettingsItem(
				label: "Chat", kind: .section, key: "chatInbound",
				navKey: nil, children: [],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
		]
		store.selectedNavKey = "chatInbound"
		store.sectionDetailLoading = true
		store.selectedSectionDetail = nil
		let view = ConfigureView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-detail-skeleton")
		}
	}
}
