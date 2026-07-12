import SwiftUI

/// Client-local Appearance settings: light/dark/system mode and accent swatches.
struct AppearanceSettingsView: View {
	@Bindable var preferences: AppearancePreferences

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 28) {
				VStack(alignment: .leading, spacing: 6) {
					Text("Appearance")
						.font(.title2.weight(.semibold))
						.foregroundStyle(AppTheme.primaryText)
					Text("Choose how Toby looks and which accent color highlights actions.")
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
						.fixedSize(horizontal: false, vertical: true)
				}

				SettingsCard {
					VStack(alignment: .leading, spacing: 12) {
						SettingsSectionHeader(title: "Theme")
						Picker("Theme", selection: $preferences.mode) {
							ForEach(AppearanceMode.allCases) { mode in
								Text(mode.displayName).tag(mode)
							}
						}
						.pickerStyle(.segmented)
						.labelsHidden()
						.accessibilityIdentifier("appearance-mode-picker")
					}
					.padding(14)
				}

				SettingsCard {
					VStack(alignment: .leading, spacing: 14) {
						SettingsSectionHeader(title: "Accent color")
						LazyVGrid(
							columns: [
								GridItem(.adaptive(minimum: 36, maximum: 44), spacing: 12),
							],
							alignment: .leading,
							spacing: 12
						) {
							ForEach(AccentPreset.allCases) { preset in
								AccentSwatchButton(
									preset: preset,
									isSelected: preferences.accent == preset,
								) {
									preferences.accent = preset
								}
							}
						}
						.accessibilityIdentifier("appearance-accent-swatches")
					}
					.padding(14)
				}
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth, alignment: .leading)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(AppTheme.contentPadding)
		}
		.background(SettingsDesign.canvasBackground)
	}
}

private struct AccentSwatchButton: View {
	let preset: AccentPreset
	let isSelected: Bool
	let action: () -> Void

	@State private var isHovered = false

	var body: some View {
		Button(action: action) {
			ZStack {
				Circle()
					.fill(preset.color)
					.frame(width: 28, height: 28)
				if isSelected {
					Circle()
						.strokeBorder(AppTheme.primaryText, lineWidth: 2.5)
						.frame(width: 36, height: 36)
				} else if isHovered {
					Circle()
						.strokeBorder(AppTheme.secondaryText.opacity(0.5), lineWidth: 1.5)
						.frame(width: 36, height: 36)
				}
			}
			.frame(width: 40, height: 40)
			.contentShape(Circle())
		}
		.buttonStyle(.plain)
		.onHover { isHovered = $0 }
		.help(preset.displayName)
		.accessibilityLabel(preset.displayName)
		.accessibilityAddTraits(isSelected ? .isSelected : [])
		.accessibilityIdentifier("appearance-accent-\(preset.rawValue)")
	}
}
