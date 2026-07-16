import SwiftUI

/// Client-local General settings: startup, menu bar, theme, and accent color.
struct AppearanceSettingsView: View {
	@Bindable var preferences: AppearancePreferences

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 28) {
				VStack(alignment: .leading, spacing: 6) {
					Text("General")
						.font(.title2.weight(.semibold))
						.foregroundStyle(AppTheme.primaryText)
					Text(
						"Startup, menu bar, and how Toby looks on this Mac."
					)
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
				}

				SettingsCard {
					SettingsRow(
						title: "Start at login",
						description:
							"Open Toby automatically when you log in to this Mac. Off by default.",
						showsDivider: true
					) {
						SettingsToggle(isOn: $preferences.launchAtLogin)
							.accessibilityIdentifier("general-launch-at-login-toggle")
					}
					SettingsRow(
						title: "Show menu bar icon",
						description:
							"Show Toby in the menu bar for quick access to chat, recording, and windows. On by default.",
						showsDivider: false
					) {
						SettingsToggle(isOn: $preferences.showMenuBarIcon)
							.accessibilityIdentifier("general-show-menu-bar-icon-toggle")
					}
				}

				if preferences.launchAtLogin, let error = preferences.launchAtLoginError {
					launchAtLoginNotice(message: error, isError: true)
				} else if preferences.launchAtLogin, LaunchAtLogin.requiresApproval {
					launchAtLoginNotice(
						message:
							"Toby is waiting for approval in System Settings → General → Login Items.",
						isError: false
					)
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

	@ViewBuilder
	private func launchAtLoginNotice(message: String, isError: Bool) -> some View {
		HStack(alignment: .top, spacing: 10) {
			Image(systemName: isError ? "exclamationmark.triangle.fill" : "info.circle.fill")
				.foregroundStyle(isError ? Color.orange : AppTheme.accent)
			VStack(alignment: .leading, spacing: 6) {
				Text(message)
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
				Button("Open Login Items Settings…") {
					LaunchAtLogin.openLoginItemsSettings()
				}
				.buttonStyle(.link)
				.font(.subheadline)
			}
		}
		.padding(12)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(SettingsDesign.cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
		.accessibilityIdentifier("general-launch-at-login-notice")
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
