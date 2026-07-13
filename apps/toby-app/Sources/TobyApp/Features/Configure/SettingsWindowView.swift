import SwiftUI

/// Preferences-style Settings window: top toolbar tabs (icon over label) for
/// each top-level section, with nested sections (e.g. AI providers) shown as
/// an inner sidebar. Uses a custom tab bar instead of `TabView` so the chrome
/// never collapses when the window is narrow or when a hierarchical pane is
/// shown (NavigationSplitView would steal the toolbar).
struct SettingsWindowView: View {
	@Bindable var store: ConfigureStore
	@State private var appearancePreferences = AppearancePreferences.shared
	/// Local tab selection so the client-only Appearance tab can be selected
	/// without going through the daemon-backed configure store.
	@State private var selectedTabKey: String = SettingsItem.appearanceSectionKey

	private var allSections: [SettingsItem] {
		[SettingsItem.appearanceSection] + store.settingsSections
	}

	private var selectedTopLevelSection: SettingsItem? {
		allSections.first {
			ConfigureTreeHelpers.sectionIdentityKey($0) == selectedTabKey
		}
	}

	private var isAppearanceTab: Bool {
		selectedTabKey == SettingsItem.appearanceSectionKey
	}

	var body: some View {
		Group {
			if store.isLoading && store.settingsSections.isEmpty {
				// Still show Appearance while daemon sections load.
				VStack(spacing: 0) {
					tabBar
					Divider().background(AppTheme.separator)
					settingsContent
						.frame(maxWidth: .infinity, maxHeight: .infinity)
				}
			} else if let errorMessage = store.errorMessage, store.settingsSections.isEmpty {
				// Appearance remains available even if configure API fails.
				VStack(spacing: 0) {
					tabBar
					Divider().background(AppTheme.separator)
					if isAppearanceTab {
						AppearanceSettingsView(preferences: appearancePreferences)
					} else {
						ContentUnavailableView {
							Label("Configuration unavailable", systemImage: "exclamationmark.triangle")
						} description: {
							Text(errorMessage)
						}
						.frame(maxWidth: .infinity, maxHeight: .infinity)
						.background(SettingsDesign.canvasBackground)
					}
				}
			} else {
				VStack(spacing: 0) {
					tabBar
					Divider()
						.background(AppTheme.separator)

					settingsContent
						.frame(maxWidth: .infinity, maxHeight: .infinity)
				}
			}
		}
		.frame(minWidth: 640, minHeight: 420)
		// Observe epoch so canvas re-tints; id is only on the background fill.
		.background(
			SettingsDesign.canvasBackground
				.id("settings-canvas-\(appearancePreferences.themeEpoch)")
		)
		.task {
			await store.loadSettingsSections()
			// Only honor an intentional store selection (deep link). Do not
			// re-apply a stale Chat/AI nav key after the user is on Appearance
			// or after a theme flip rebuilds this task.
			if store.selectedNavKey != nil {
				syncTabFromStoreSelection()
			}
		}
		.onChange(of: store.selectedNavKey) { _, newKey in
			// Deep links set selectedNavKey; ignore clears and leave Appearance alone.
			guard newKey != nil else { return }
			syncTabFromStoreSelection()
		}
		.onDisappear {
			Task { await store.flushPendingSave() }
		}
		.alert(
			store.pendingDelete?.title ?? "",
			isPresented: Binding(
				get: { store.pendingDelete != nil },
				set: { if !$0 { store.pendingDelete = nil } },
			),
		) {
			Button("Cancel", role: .cancel) {
				store.pendingDelete = nil
			}
			Button(store.pendingDelete?.confirmLabel ?? "Delete", role: .destructive) {
				Task { await store.confirmDelete() }
			}
		} message: {
			Text(store.pendingDelete?.message ?? "")
		}
		.sheet(
			isPresented: Binding(
				get: { store.setupGuidePresented },
				set: { if !$0 { store.dismissSetupGuide() } },
			),
		) {
			if let section = store.settingsSelectedSection ?? store.selectedSection {
				IntegrationSetupWizardView(store: store, section: section)
			}
		}
	}

	private var tabBar: some View {
		SettingsPreferencesTabBar(
			sections: allSections,
			selectedKey: selectedTabKey,
			onSelect: { key in
				selectedTabKey = key
				if key == SettingsItem.appearanceSectionKey {
					// Clear daemon selection so a later theme/task refresh cannot
					// yank the user off Appearance back to Chat (or another tab).
					store.selectedNavKey = nil
				} else {
					store.selectTopLevelTab(key)
				}
			},
		)
		.accessibilityIdentifier("settings-preferences-tab-bar")
	}

	@ViewBuilder
	private var settingsContent: some View {
		Group {
			if isAppearanceTab {
				AppearanceSettingsView(preferences: appearancePreferences)
			} else if let section = selectedTopLevelSection,
				ConfigureTreeHelpers.hasNestedSections(section)
			{
				// Manual split — avoid NavigationSplitView, which replaces the
				// window toolbar and can hide the preferences tab bar.
				HStack(spacing: 0) {
					SettingsHierarchySidebarView(store: store, parent: section)
						.frame(width: 220)
						.frame(maxHeight: .infinity)

					Divider()
						.background(AppTheme.separator)

					ConfigureDetailView(store: store)
						.frame(maxWidth: .infinity, maxHeight: .infinity)
				}
			} else {
				ConfigureDetailView(store: store)
			}
		}
		// Refresh form labels/cards on theme flip without remounting the tab bar.
		.tobyThemeRefreshable()
	}

	/// When the configure store has a section selection (deep link or prior
	/// server tab), switch the client tab bar to match.
	private func syncTabFromStoreSelection() {
		// Never override an in-progress Appearance choice with a stale nav key.
		if selectedTabKey == SettingsItem.appearanceSectionKey,
			store.selectedNavKey == nil
		{
			return
		}
		guard let key = store.selectedTopLevelKey,
			store.settingsSections.contains(where: {
				ConfigureTreeHelpers.sectionIdentityKey($0) == key
			})
		else { return }
		selectedTabKey = key
		store.selectTopLevelTab(key)
	}
}

// MARK: - Preferences tab bar (icon over text)

/// Horizontal preferences-style strip: SF Symbol above caption, always visible.
/// Scrolls horizontally when the window is too narrow for all tabs.
struct SettingsPreferencesTabBar: View {
	let sections: [SettingsItem]
	let selectedKey: String
	let onSelect: (String) -> Void

	var body: some View {
		GeometryReader { geo in
			ScrollView(.horizontal, showsIndicators: false) {
				HStack(spacing: 0) {
					Spacer(minLength: 12)
					HStack(spacing: 4) {
						ForEach(sections, id: \.key) { section in
							let key = ConfigureTreeHelpers.sectionIdentityKey(section)
							SettingsPreferencesTab(
								title: section.label,
								systemImage: SettingsSidebarIcon.systemName(for: section),
								isSelected: key == selectedKey,
							) {
								onSelect(key)
							}
						}
					}
					Spacer(minLength: 12)
				}
				// At least as wide as the bar so Spacers center the tabs when they fit.
				.frame(minWidth: geo.size.width)
				.padding(.vertical, 10)
			}
		}
		.frame(height: 64)
		.background(AppTheme.panelBackground.opacity(0.55))
	}
}

private struct SettingsPreferencesTab: View {
	let title: String
	let systemImage: String
	let isSelected: Bool
	let action: () -> Void

	@State private var isHovered = false

	var body: some View {
		Button(action: action) {
			VStack(spacing: 4) {
				Image(systemName: systemImage)
					.font(.system(size: 18, weight: .medium))
					.symbolRenderingMode(.hierarchical)
					.foregroundStyle(iconColor)
					.frame(height: 22)

				Text(title)
					.font(.system(size: 11, weight: isSelected ? .semibold : .medium))
					.foregroundStyle(labelColor)
					.lineLimit(1)
					.fixedSize(horizontal: true, vertical: false)
			}
			.padding(.horizontal, 10)
			.padding(.vertical, 6)
			.frame(minWidth: 64)
			.contentShape(RoundedRectangle(cornerRadius: 8))
			.background(
				RoundedRectangle(cornerRadius: 8)
					.fill(backgroundFill)
			)
		}
		.buttonStyle(.plain)
		.onHover { isHovered = $0 }
		.help(title)
		.accessibilityLabel(title)
		.accessibilityAddTraits(isSelected ? .isSelected : [])
	}

	private var iconColor: Color {
		if isSelected { return AppTheme.accent }
		if isHovered { return AppTheme.primaryText }
		return AppTheme.secondaryText
	}

	private var labelColor: Color {
		if isSelected { return AppTheme.primaryText }
		if isHovered { return AppTheme.primaryText }
		return AppTheme.secondaryText
	}

	private var backgroundFill: Color {
		if isSelected { return AppTheme.selection }
		if isHovered { return AppTheme.selection.opacity(0.5) }
		return .clear
	}
}
