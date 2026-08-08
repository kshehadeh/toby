import AppKit
import SwiftUI

/// Client-local General settings: home directory, startup, menu bar, chat mode, theme, and accent.
struct AppearanceSettingsView: View {
	@Bindable var preferences: AppearancePreferences
	/// Applies a home-directory switch (soft reset). `nil` restores default `~/.toby`.
	var onSwitchTobyHome: ((String?) async throws -> Void)? = nil

	@State private var pendingHomePath: String?
	@State private var isConfirmingHomeSwitch = false
	@State private var isSwitchingHome = false
	@State private var homeSwitchError: String?

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 28) {
				VStack(alignment: .leading, spacing: 6) {
					Text("General")
						.font(.title2.weight(.semibold))
						.foregroundStyle(AppTheme.primaryText)
					Text(
						"Home directory, startup, menu bar, chat transcript detail, and how Toby looks on this Mac."
					)
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
				}

				homeDirectoryCard

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
						showsDivider: true
					) {
						SettingsToggle(isOn: $preferences.showMenuBarIcon)
							.accessibilityIdentifier("general-show-menu-bar-icon-toggle")
					}
					SettingsRow(
						title: "Command palette shortcut",
						description:
							"Summon Toby's command palette from anywhere, like Spotlight.",
						showsDivider: true
					) {
						GlobalShortcutRecorder(preferences: preferences, action: .commandPalette)
							.accessibilityIdentifier("general-shortcut-command-palette")
					}
					SettingsRow(
						title: "Start/stop recording shortcut",
						description:
							"Start or stop an audio recording without switching to Toby.",
						showsDivider: true
					) {
						GlobalShortcutRecorder(preferences: preferences, action: .toggleRecording)
							.accessibilityIdentifier("general-shortcut-toggle-recording")
					}
					SettingsRow(
						title: "New chat shortcut",
						description:
							"Bring Toby to the front and start a fresh chat session.",
						showsDivider: false
					) {
						GlobalShortcutRecorder(preferences: preferences, action: .newChat)
							.accessibilityIdentifier("general-shortcut-new-chat")
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
						SettingsSectionHeader(title: "Chat mode")
						Text(
							"Normal shows the conversation and an expandable Working log of the steps that ran. Debug also reveals skill and tool selection and other pipeline detail."
						)
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
						.fixedSize(horizontal: false, vertical: true)
						Picker("Chat mode", selection: $preferences.chatTranscriptMode) {
							ForEach(ChatTranscriptMode.allCases) { mode in
								Text(mode.displayName).tag(mode)
							}
						}
						.pickerStyle(.segmented)
						.labelsHidden()
						.accessibilityIdentifier("general-chat-mode-picker")
					}
					.padding(14)
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
		.disabled(isSwitchingHome)
		.alert(
			"Switch Toby home directory?",
			isPresented: $isConfirmingHomeSwitch,
			presenting: pendingHomePath
		) { path in
			Button("Cancel", role: .cancel) {
				pendingHomePath = nil
			}
			Button("Switch") {
				Task { await performHomeSwitch(to: path) }
			}
			.keyboardShortcut(.defaultAction)
		} message: { path in
			let displayPath = path.isEmpty ? ConfigReader.defaultTobyDir() : path
			Text(
				"""
				Toby will stop the local server and reload sessions, settings, plugins, and recordings from:

				\(displayPath)

				This does not copy data from the current home.
				"""
			)
		}
		.alert(
			"Could not switch home",
			isPresented: Binding(
				get: { homeSwitchError != nil },
				set: { if !$0 { homeSwitchError = nil } }
			)
		) {
			Button("OK", role: .cancel) { homeSwitchError = nil }
		} message: {
			Text(homeSwitchError ?? "")
		}
	}

	// MARK: - Home directory

	private var homeDirectoryCard: some View {
		SettingsCard {
			VStack(alignment: .leading, spacing: 12) {
				HStack(alignment: .firstTextBaseline, spacing: 8) {
					SettingsSectionHeader(title: "Home directory")
					Spacer(minLength: 0)
					Text(preferences.hasCustomTobyDirOverride || ConfigReader.isCustomTobyDir() ? "Custom" : "Default")
						.font(.caption.weight(.semibold))
						.foregroundStyle(AppTheme.secondaryText)
						.padding(.horizontal, 8)
						.padding(.vertical, 3)
						.background(AppTheme.secondaryText.opacity(0.12), in: Capsule())
						.accessibilityIdentifier("general-home-directory-badge")
				}
				Text(
					"Where Toby stores config, chat history, plugins, and recordings on this Mac. Switching reloads all app data and restarts the local server. It does not copy data between homes."
				)
				.font(.subheadline)
				.foregroundStyle(AppTheme.secondaryText)
				.fixedSize(horizontal: false, vertical: true)

				Text(preferences.resolvedTobyDir)
					.font(.system(.caption, design: .monospaced))
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(3)
					.truncationMode(.middle)
					.textSelection(.enabled)
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(10)
					.background(AppTheme.secondaryText.opacity(0.08))
					.clipShape(RoundedRectangle(cornerRadius: 8))
					.accessibilityIdentifier("general-home-directory-path")

				HStack(spacing: 10) {
					Button("Choose…") {
						presentHomeDirectoryChooser()
					}
					.buttonStyle(.bordered)
					.disabled(isSwitchingHome || onSwitchTobyHome == nil)
					.accessibilityIdentifier("general-home-directory-choose")

					Button("Use Default") {
						requestHomeSwitch(to: nil)
					}
					.buttonStyle(.bordered)
					.disabled(
						isSwitchingHome
							|| onSwitchTobyHome == nil
							|| (!preferences.hasCustomTobyDirOverride && !ConfigReader.isCustomTobyDir())
					)
					.accessibilityIdentifier("general-home-directory-use-default")

					Button("Reveal in Finder") {
						RevealInFinder.reveal(path: preferences.resolvedTobyDir)
					}
					.buttonStyle(.bordered)
					.accessibilityIdentifier("general-home-directory-reveal")

					if isSwitchingHome {
						ProgressView()
							.controlSize(.small)
							.accessibilityIdentifier("general-home-directory-switching")
					}
				}
			}
			.padding(14)
		}
	}

	private func presentHomeDirectoryChooser() {
		let panel = NSOpenPanel()
		panel.canChooseFiles = false
		panel.canChooseDirectories = true
		panel.canCreateDirectories = true
		panel.allowsMultipleSelection = false
		panel.directoryURL = URL(fileURLWithPath: preferences.resolvedTobyDir)
		panel.prompt = "Choose"
		panel.message = "Choose a folder for Toby’s home directory (data root)."
		guard panel.runModal() == .OK, let url = panel.url else { return }
		requestHomeSwitch(to: url.path)
	}

	/// `path == nil` means restore default; empty string is also treated as default in the alert.
	private func requestHomeSwitch(to path: String?) {
		homeSwitchError = nil
		if let path {
			pendingHomePath = ConfigReader.standardizePath(path)
		} else {
			// Sentinel for “use default” in the confirmation alert.
			pendingHomePath = ""
		}
		isConfirmingHomeSwitch = true
	}

	private func performHomeSwitch(to path: String) async {
		guard let onSwitchTobyHome else { return }
		isSwitchingHome = true
		defer { isSwitchingHome = false }
		do {
			let target: String? = path.isEmpty ? nil : path
			try await onSwitchTobyHome(target)
			pendingHomePath = nil
		} catch {
			homeSwitchError = error.localizedDescription
			pendingHomePath = nil
		}
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
