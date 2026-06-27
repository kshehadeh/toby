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

	@Test("SettingsItem decodes iconUrl from JSON")
	func settingsItemDecodesIconUrl() throws {
		let json = """
		{
			"label": "OpenAI",
			"kind": "section",
			"key": "ai.openai",
			"iconUrl": "/icons/ai/openai.png"
		}
		""".data(using: .utf8)!
		let item = try JSONDecoder().decode(SettingsItem.self, from: json)
		#expect(item.iconUrl == "/icons/ai/openai.png")
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
