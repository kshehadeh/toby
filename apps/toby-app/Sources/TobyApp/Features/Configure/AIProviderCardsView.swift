import SwiftUI

/// Card-based selection grid shown on the AI parent configuration page.
/// Each available provider gets a card with icon, title, description, and
/// a CTA that navigates to that provider's configuration section.
struct AIProviderCardsView: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem

	private var providerSections: [SettingsItem] {
		(section.children ?? []).filter { child in
			child.kind == .section && !(child.children?.isEmpty ?? true)
		}
	}

	private let columns = [
		GridItem(.flexible(), spacing: 16),
		GridItem(.flexible(), spacing: 16),
	]

	var body: some View {
		VStack(alignment: .leading, spacing: 20) {
			VStack(alignment: .leading, spacing: 6) {
				Text("AI Providers")
					.font(.title2.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				Text("Choose a provider to configure its credentials and start chatting with AI models.")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
			}

			LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
				ForEach(providerSections, id: \.id) { provider in
					AIProviderCard(
						provider: provider,
						onConfigure: {
							store.selectSection(provider.navKey ?? provider.key)
						},
					)
				}
			}
		}
	}
}

private struct AIProviderCard: View {
	let provider: SettingsItem
	let onConfigure: () -> Void

	private var iconURL: URL? {
		guard let iconUrl = provider.iconUrl, !iconUrl.isEmpty else { return nil }
		return URL(string: ConfigReader.baseURL().absoluteString + iconUrl)
	}

	private var docURL: URL? {
		guard let docUrl = provider.docUrl, !docUrl.isEmpty else { return nil }
		return URL(string: docUrl)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 14) {
			HStack(spacing: 12) {
				RoundedRectangle(cornerRadius: 10)
					.fill(AppTheme.accent.opacity(0.15))
					.frame(width: 44, height: 44)
					.overlay {
						if let iconURL {
							SidebarIconView(
								url: iconURL,
								fallbackSystemName: "cpu",
								isSelected: true,
							)
							.frame(width: 30, height: 30)
						} else if let icon = provider.icon, !icon.isEmpty {
							Text(icon)
								.font(.system(size: 24))
						} else {
							Image(systemName: "cpu")
								.font(.system(size: 20, weight: .medium))
								.foregroundStyle(AppTheme.accent)
						}
					}

				Text(provider.label)
					.font(.headline)
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
			}

			if let description = provider.description, !description.isEmpty {
				Text(description)
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
					.lineLimit(3)
			}

			if let docURL {
				Link(destination: docURL) {
					HStack(spacing: 4) {
						Text("Documentation")
							.font(.subheadline.weight(.medium))
						Image(systemName: "arrow.up.right.square")
							.font(.subheadline)
					}
					.foregroundStyle(AppTheme.accent)
				}
				.help(docURL.absoluteString)
			}

			Spacer(minLength: 0)

			HStack {
				Spacer()
				Button(action: onConfigure) {
					Text("Configure")
						.font(.subheadline.weight(.medium))
				}
				.buttonStyle(.borderedProminent)
				.controlSize(.regular)
			}
		}
		.padding(18)
		.frame(maxWidth: .infinity, alignment: .leading)
		.frame(minHeight: 180)
		.background(SettingsDesign.cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
		.contentShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.onTapGesture(perform: onConfigure)
	}
}
