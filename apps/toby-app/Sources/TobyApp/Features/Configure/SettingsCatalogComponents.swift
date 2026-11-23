import SwiftUI

struct SettingsCatalogHeader: View {
	let title: String
	let subtitle: String
	let systemImage: String

	var body: some View {
		VStack(spacing: 10) {
			RoundedRectangle(cornerRadius: 16, style: .continuous)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 64, height: 64)
				.overlay {
					Image(systemName: systemImage)
						.font(.system(size: 28, weight: .medium))
						.foregroundStyle(AppTheme.accent)
				}
			Text(title)
				.font(.title2.weight(.semibold))
				.foregroundStyle(.primary)
			Text(subtitle)
				.font(.subheadline)
				.foregroundStyle(.secondary)
				.multilineTextAlignment(.center)
		}
		.padding(.vertical, 8)
	}
}

struct SettingsCatalogAddRow: View {
	let title: String
	var accessibilityIdentifier: String = "settings-catalog-add-row"
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			HStack(spacing: 10) {
				Image(systemName: "plus")
					.font(.system(size: 14, weight: .semibold))
					.foregroundStyle(AppTheme.accent)
					.frame(width: 24, height: 24)
					.accessibilityHidden(true)
				Text(title)
					.foregroundStyle(AppTheme.accent)
				Spacer(minLength: 8)
			}
		}
		.buttonStyle(.plain)
		.accessibilityLabel(title)
		.accessibilityIdentifier(accessibilityIdentifier)
	}
}

