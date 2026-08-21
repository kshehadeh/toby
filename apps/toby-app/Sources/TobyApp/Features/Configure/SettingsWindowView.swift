import SwiftUI

/// Preferences-style Settings window: top toolbar tabs (icon over label) for
/// each top-level section, with nested sections (e.g. AI providers) shown as
/// an inner sidebar. Uses a custom tab bar instead of `TabView` so the chrome
/// never collapses when the window is narrow or when a hierarchical pane is
/// shown (NavigationSplitView would steal the toolbar).
struct SettingsWindowView: View {
	@Bindable var store: ConfigureStore
	/// Soft-resets the app onto a new Toby data root (`nil` = default `~/.toby`).
	var onSwitchTobyHome: ((String?) async throws -> Void)? = nil
	@State private var appearancePreferences = AppearancePreferences.shared
	/// Local tab selection so the client-only General tab can be selected
	/// without going through the daemon-backed configure store.
	@State private var selectedTabKey: String = SettingsItem.appearanceSectionKey
	@AppStorage(AppearanceDefaultsKey.settingsLastTab)
	private var lastTabKey = SettingsItem.appearanceSectionKey
	@State private var isRestoringTab = false

	private var allSections: [SettingsItem] {
		[
			SettingsItem.appearanceSection,
			SettingsItem.iCloudSection,
			SettingsItem.personasSection,
		] + store.settingsSections
	}

	private var selectedTopLevelSection: SettingsItem? {
		allSections.first {
			ConfigureTreeHelpers.sectionIdentityKey($0) == selectedTabKey
		}
	}

	private var isGeneralTab: Bool {
		selectedTabKey == SettingsItem.appearanceSectionKey
	}

	private var isPersonasTab: Bool {
		selectedTabKey == SettingsItem.personasSectionKey
	}

	private var isICloudTab: Bool {
		selectedTabKey == SettingsItem.iCloudSectionKey
	}

	private static let clientOnlyTabKeys: Set<String> = [
		SettingsItem.appearanceSectionKey,
		SettingsItem.iCloudSectionKey,
		SettingsItem.personasSectionKey,
	]

	var body: some View {
		Group {
			if store.isLoading && store.settingsSections.isEmpty {
				// Still show General while daemon sections load.
				VStack(spacing: 0) {
					tabBar
					Divider().background(AppTheme.separator)
					settingsContent
						.frame(maxWidth: .infinity, maxHeight: .infinity)
				}
			} else if let errorMessage = store.errorMessage, store.settingsSections.isEmpty {
				// General, iCloud, and Personas remain available even if configure API fails.
				VStack(spacing: 0) {
					tabBar
					Divider().background(AppTheme.separator)
					if isGeneralTab {
						AppearanceSettingsView(
							preferences: appearancePreferences,
							onSwitchTobyHome: onSwitchTobyHome
						)
					} else if isPersonasTab {
						PersonasSettingsView(store: store)
					} else if isICloudTab {
						ICloudSyncSettingsView()
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
			isRestoringTab = true
			let requestedNavKey = store.selectedNavKey
			await store.loadSettingsSections()
			if requestedNavKey != nil {
				// Deep links take precedence over the remembered tab.
				syncTabFromStoreSelection()
			} else if let restoredKey = restoredTabKey {
				selectedTabKey = restoredKey
				if Self.clientOnlyTabKeys.contains(restoredKey) {
					store.selectedNavKey = nil
				} else {
					store.selectTopLevelTab(restoredKey)
				}
			}
			isRestoringTab = false
		}
		.onChange(of: store.selectedNavKey) { _, newKey in
			// Deep links set selectedNavKey; ignore clears and leave Appearance alone.
			guard !isRestoringTab, newKey != nil else { return }
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
				lastTabKey = key
				if Self.clientOnlyTabKeys.contains(key) {
					// Clear daemon selection so a later theme/task refresh cannot
					// yank the user off a client-only tab back to a daemon section.
					store.selectedNavKey = nil
				} else {
					store.selectTopLevelTab(key)
				}
			},
		)
		.accessibilityIdentifier("settings-preferences-tab-bar")
	}

	private var restoredTabKey: String? {
		if Self.clientOnlyTabKeys.contains(lastTabKey) {
			return lastTabKey
		}
		guard allSections.contains(where: {
			ConfigureTreeHelpers.sectionIdentityKey($0) == lastTabKey
		}) else {
			return SettingsItem.appearanceSectionKey
		}
		return lastTabKey
	}

	@ViewBuilder
	private var settingsContent: some View {
		Group {
			if isGeneralTab {
				AppearanceSettingsView(
					preferences: appearancePreferences,
					onSwitchTobyHome: onSwitchTobyHome
				)
			} else if isPersonasTab {
				PersonasSettingsView(store: store)
			} else if isICloudTab {
				ICloudSyncSettingsView()
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
		// Never override an in-progress General choice with a stale nav key.
		if selectedTabKey == SettingsItem.appearanceSectionKey,
			store.selectedNavKey == nil
		{
			return
		}
		// Handle client-only tabs (General, Personas) — these are not in the
		// daemon settings sections tree.
		if let key = store.selectedNavKey,
			Self.clientOnlyTabKeys.contains(key)
		{
			selectedTabKey = key
			lastTabKey = key
			store.selectedNavKey = nil
			return
		}
		guard let key = store.selectedTopLevelKey,
			store.settingsSections.contains(where: {
				ConfigureTreeHelpers.sectionIdentityKey($0) == key
			})
		else { return }
		selectedTabKey = key
		lastTabKey = key
		store.selectTopLevelTab(key)
	}
}

// MARK: - Preferences tab bar (icon over text)

/// Horizontal preferences-style strip: SF Symbol above caption, always visible.
/// Scrolls horizontally when the window is too narrow for all tabs. When the
/// tabs overflow, a fade + chevron affordance appears on the trailing edge so
/// the hidden tabs are discoverable; tapping it reveals the remaining tabs.
struct SettingsPreferencesTabBar: View {
	let sections: [SettingsItem]
	let selectedKey: String
	let onSelect: (String) -> Void

	private static let edgeInset: CGFloat = 12
	/// Width of the chevron affordance, so the tap-to-scroll target can clear
	/// the button rather than leaving the end tab tucked underneath it.
	private static let affordanceWidth: CGFloat = 44
	private static let scrollSpace = "settings-tab-bar-scroll"
	private static let leadingAnchor = "settings-tab-bar-leading-end"
	private static let trailingAnchor = "settings-tab-bar-trailing-end"

	/// Full width of the scrollable row content, read from the row's backing
	/// geometry (`size.width`) so it always reflects the true overflow,
	/// independent of any coordinate-space frame clamping.
	@State private var contentWidth: CGFloat = 0
	/// Horizontal scroll offset: the content's leading edge measured in the
	/// scroll coordinate space. `0` at rest, growing negative as the row
	/// scrolls toward the trailing tabs.
	@State private var scrollOffset: CGFloat = 0
	/// Width of the visible scroll viewport (the tab strip), read from the
	/// scroll view's own geometry so the row no longer needs a wrapping
	/// `GeometryReader`.
	@State private var viewportWidth: CGFloat = 0
	/// Vertical inset that centres the 52pt tabs inside the 64pt bar. Both the
	/// fit and scroll branches use it so switching between them never nudges
	/// the strip vertically.
	private static let verticalInset: CGFloat = 6

	// A pixel of slack absorbs sub-point rounding so the affordances don't
	// flicker at the extremes.
	private var canScrollLeading: Bool { -scrollOffset > 1 }
	private var canScrollTrailing: Bool {
		contentWidth - viewportWidth + scrollOffset > 1
	}

	var body: some View {
		// ViewThatFits natively selects the first branch that fits the bar
		// width. When every tab fits, the centered row is used; when they
		// overflow, SwiftUI falls through to the scrollable branch — which
		// carries the chevron affordances. The scrollable branch then measures
		// its content and scroll offset to toggle the leading/trailing chevrons.
		ViewThatFits(in: .horizontal) {
			tabButtons
				.padding(.horizontal, Self.edgeInset)
				.padding(.vertical, Self.verticalInset)

			scrollableTabRow
		}
		.frame(maxWidth: .infinity)
		.frame(height: 64)
		.background(AppTheme.panelBackground.opacity(0.55))
	}

	private var tabButtons: some View {
		HStack(spacing: 4) {
			ForEach(sections, id: \.key) { section in
				let key = ConfigureTreeHelpers.sectionIdentityKey(section)
				SettingsPreferencesTab(
					title: section.displayLabel,
					systemImage: SettingsSidebarIcon.systemName(for: section),
					isSelected: key == selectedKey,
				) {
					onSelect(key)
				}
				.id(key)
			}
		}
	}

	private var scrollableTabRow: some View {
		// No wrapping GeometryReader here: it pinned the content to the top and
		// nudged the strip down a few points relative to the non-scroll branch.
		// The viewport width is read from the scroll view's own background
		// instead, so this branch lays out vertically just like the fit branch.
		ScrollViewReader { proxy in
			ScrollView(.horizontal, showsIndicators: false) {
				HStack(spacing: 0) {
					// Zero-content anchors at the true edges (outside the
					// tabs) let a tap scroll all the way to each end, past
					// the insets, so the affordance can fully retract.
					Color.clear
						.frame(width: Self.edgeInset)
						.id(Self.leadingAnchor)

					tabButtons

					Color.clear
						.frame(width: Self.edgeInset)
						.id(Self.trailingAnchor)
				}
				.padding(.vertical, Self.verticalInset)
				.background(
					// Assign the measurements straight to @State rather than
					// routing them through preferences: ViewThatFits does not
					// reliably propagate child preferences to `.onPreferenceChange`
					// on an ancestor, which left the extents stuck at zero and
					// the affordances permanently hidden.
					GeometryReader { contentGeo in
						let width = contentGeo.size.width
						let offset = contentGeo.frame(in: .named(Self.scrollSpace)).minX
						Color.clear
							.onAppear {
								contentWidth = width
								scrollOffset = offset
							}
							.onChange(of: width) { _, newValue in
								contentWidth = newValue
							}
							.onChange(of: offset) { _, newValue in
								scrollOffset = newValue
							}
					},
				)
			}
			.coordinateSpace(name: Self.scrollSpace)
			.background(
				GeometryReader { viewportGeo in
					let width = viewportGeo.size.width
					Color.clear
						.onAppear { viewportWidth = width }
						.onChange(of: width) { _, newValue in
							viewportWidth = newValue
						}
				},
			)
			.overlay(alignment: .leading) {
				if canScrollLeading {
					scrollAffordance(edge: .leading) {
						withAnimation(.easeInOut(duration: 0.22)) {
							proxy.scrollTo(Self.leadingAnchor, anchor: .leading)
						}
					}
					.transition(.opacity)
				}
			}
			.overlay(alignment: .trailing) {
				if canScrollTrailing {
					scrollAffordance(edge: .trailing) {
						withAnimation(.easeInOut(duration: 0.22)) {
							proxy.scrollTo(Self.trailingAnchor, anchor: .trailing)
						}
					}
					.transition(.opacity)
				}
			}
			.animation(.easeInOut(duration: 0.15), value: canScrollLeading)
			.animation(.easeInOut(duration: 0.15), value: canScrollTrailing)
		}
	}

	private func scrollAffordance(
		edge: HorizontalEdge,
		action: @escaping () -> Void,
	) -> some View {
		let isLeading = edge == .leading
		let fade = LinearGradient(
			colors: [
				AppTheme.panelBackground.opacity(0),
				AppTheme.panelBackground.opacity(0.9),
			],
			startPoint: isLeading ? .trailing : .leading,
			endPoint: isLeading ? .leading : .trailing,
		)
		.frame(width: 24)
		.allowsHitTesting(false)

		let button = Button(action: action) {
			Image(systemName: isLeading ? "chevron.left" : "chevron.right")
				.font(.system(size: 12, weight: .bold))
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: Self.affordanceWidth - 24, height: 64)
				.background(AppTheme.panelBackground.opacity(0.9))
				.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.help("Show more tabs")
		.accessibilityLabel("Show more tabs")
		.accessibilityIdentifier(
			isLeading ? "settings-tab-bar-scroll-leading" : "settings-tab-bar-scroll-trailing",
		)

		return HStack(spacing: 0) {
			if isLeading {
				button
				fade
			} else {
				fade
				button
			}
		}
		.frame(height: 64)
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
