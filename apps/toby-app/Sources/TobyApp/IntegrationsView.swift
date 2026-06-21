import SwiftUI

struct IntegrationsView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		NavigationSplitView {
			IntegrationsSidebarView(store: store)
				.navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)
				.toolbar(removing: .sidebarToggle)
		} detail: {
			IntegrationsDetailView(store: store)
		}
		.toolbarBackground(.visible)
		.frame(minWidth: 860, minHeight: 560)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.load()
			if let first = store.integrationSections.first,
				store.selectedNavKey == nil || !store.integrationSections.contains(where: { ($0.navKey ?? $0.key) == store.selectedNavKey })
			{
				store.selectedNavKey = first.navKey ?? first.key
			}
		}
		.onDisappear {
			Task { await store.flushPendingSave() }
		}
		.sheet(
			isPresented: Binding(
				get: { store.setupGuidePresented },
				set: { if !$0 { store.dismissSetupGuide() } },
			),
		) {
			if let section = store.selectedSection {
				IntegrationSetupWizardView(store: store, section: section)
			}
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
	}
}

extension ConfigureStore {
	var integrationSections: [SettingsItem] {
		guard let tree,
			let integrations = ConfigureTreeHelpers.findSectionByNavKey(tree, navKey: "integrations")
		else {
			return []
		}
		return (integrations.children ?? []).filter { $0.kind == .section }
	}
}

private struct IntegrationsSidebarView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		VStack(spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if store.isLoading && store.integrationSections.isEmpty {
						Text("Loading integrations…")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else if store.integrationSections.isEmpty {
						Text("No integrations")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else {
						ForEach(store.integrationSections) { section in
							Button {
								store.selectSection(section.navKey ?? section.key)
							} label: {
								IntegrationSidebarRow(
									section: section,
									isSelected: store.selectedNavKey == (section.navKey ?? section.key),
								)
							}
							.buttonStyle(.plain)
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(10)
			}
			.background(AppTheme.sidebarBackground)
		}
		.toolbar {
			// An invisible toolbar item is required so the sidebar extends into the
			// title bar area and the stoplight appears as part of the sidebar.
			ToolbarItem(placement: .confirmationAction) {
				Button {} label: {
					Color.clear
						.frame(width: 28, height: 28)
				}
				.disabled(true)
				.accessibilityHidden(true)
			}
		}
	}
}

private struct IntegrationSidebarRow: View {
	let section: SettingsItem
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: "puzzlepiece.extension")
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
				.frame(width: 20, height: 20)
			Text(section.label)
				.font(.callout.weight(.medium))
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
				.lineLimit(1)
			Spacer(minLength: 0)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 10)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
		)
	}
}

private struct IntegrationsDetailView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				if store.isLoading && store.tree == nil {
					ProgressView("Loading integrations…")
						.frame(maxWidth: .infinity, minHeight: 240)
				} else if let errorMessage = store.errorMessage, store.tree == nil {
					ContentUnavailableView {
						Label("Integrations unavailable", systemImage: "exclamationmark.triangle")
					} description: {
						Text(errorMessage)
					}
				} else if let section = store.selectedSection {
					ConfigureSectionDetailView(store: store, section: section)
				} else {
					Text("Select an integration")
						.foregroundStyle(SettingsDesign.rowDescription)
				}

				if let errorMessage = store.errorMessage, store.tree != nil {
					Text(errorMessage)
						.font(.caption)
						.foregroundStyle(.red)
				}
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth)
			.frame(maxWidth: .infinity)
			.padding(.horizontal, 32)
			.padding(.vertical, 28)
		}
		.background(SettingsDesign.canvasBackground)
	}
}
