import SwiftUI

struct IntegrationsDetailView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		VStack(spacing: 0) {
			if store.isLoading && store.tree == nil {
				ProgressView("Loading integrations…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let errorMessage = store.errorMessage, store.tree == nil {
				ContentUnavailableView {
					Label("Integrations unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let section = store.selectedSection {
				IntegrationDetailContent(store: store, section: section)
			} else {
				IntegrationsHomeView(store: store)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
	}
}

struct IntegrationsHomeView: View {
	@Bindable var store: ConfigureStore

	private let columns = [
		GridItem(.adaptive(minimum: 240, maximum: 360), spacing: 16),
	]

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				header
				LazyVGrid(columns: columns, spacing: 16) {
					ForEach(store.integrationSections) { section in
						Button {
							store.selectSection(section.navKey ?? section.key)
						} label: {
							IntegrationCard(section: section)
						}
						.buttonStyle(.plain)
						.accessibilityIdentifier("integration-card-\(section.id)")
					}
				}
			}
			.padding(24)
			.frame(maxWidth: 980)
			.frame(maxWidth: .infinity)
		}
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("integrations-home-view")
	}

	private var header: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Integrations")
				.font(.system(size: 24, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("Connect the apps and services Toby can use. Select an integration to manage its setup and credentials.")
				.font(.body)
				.foregroundStyle(SettingsDesign.rowDescription)
				.fixedSize(horizontal: false, vertical: true)
		}
	}
}

struct IntegrationCard: View {
	let section: SettingsItem

	private var iconURL: URL? {
		guard let iconUrl = section.iconUrl else { return nil }
		return URL(string: ConfigReader.baseURL().absoluteString + iconUrl)
	}

	private var description: String {
		guard let description = section.description, !description.isEmpty else {
			return "Set up and manage this integration."
		}
		return description
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			HStack(alignment: .top, spacing: 12) {
				iconView
					.frame(width: 40, height: 40)
				VStack(alignment: .leading, spacing: 4) {
					Text(section.label)
						.font(.system(size: 15, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
						.lineLimit(2)
						.multilineTextAlignment(.leading)
					Text("Integration")
						.font(.system(size: 11, weight: .medium))
						.foregroundStyle(AppTheme.tertiaryText)
				}
				Spacer(minLength: 0)
			}

			Text(description)
				.font(.system(size: 12))
				.foregroundStyle(SettingsDesign.rowDescription)
				.lineLimit(3)
				.multilineTextAlignment(.leading)
				.frame(maxWidth: .infinity, alignment: .leading)
				.frame(minHeight: 48, alignment: .topLeading)

			HStack {
				Label("Setup and credentials", systemImage: "slider.horizontal.3")
					.font(.system(size: 11))
					.foregroundStyle(AppTheme.secondaryText)
				Spacer()
				Image(systemName: "chevron.right")
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(AppTheme.tertiaryText)
					.accessibilityHidden(true)
			}
		}
		.padding(16)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		)
	}

	@ViewBuilder
	private var iconView: some View {
		if let iconURL {
			SidebarIconView(url: iconURL, fallbackSystemName: "puzzlepiece.extension", isSelected: true)
				.frame(width: 34, height: 34)
		} else if let icon = section.icon, !icon.isEmpty {
			Text(icon)
				.font(.system(size: 26))
		} else {
			RoundedRectangle(cornerRadius: 10)
				.fill(AppTheme.accent.opacity(0.16))
				.overlay {
					Image(systemName: "puzzlepiece.extension")
						.font(.system(size: 17, weight: .semibold))
						.foregroundStyle(AppTheme.accent)
						.accessibilityHidden(true)
				}
		}
	}
}
