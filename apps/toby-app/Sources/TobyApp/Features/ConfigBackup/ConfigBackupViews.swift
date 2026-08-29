import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Sheet: choose a password, then save an encrypted config backup via the daemon API.
struct ConfigBackupSheet: View {
	let onDismiss: () -> Void
	let onSuccess: (String) -> Void
	let onError: (String) -> Void

	@State private var password = ""
	@State private var confirmPassword = ""
	@State private var isWorking = false
	@State private var localError: String?
	@FocusState private var focusedField: Field?

	private enum Field: Hashable {
		case password
		case confirm
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 20) {
			Text("Backup Toby Data")
				.font(.title2.weight(.bold))
				.foregroundStyle(AppTheme.primaryText)

			Text(
				"Creates a password-protected backup of your settings, credentials, chats, schedules, flows, projects, and memories. Choose a password you will remember — it is required to restore."
			)
			.font(.subheadline)
			.foregroundStyle(AppTheme.secondaryText)
			.fixedSize(horizontal: false, vertical: true)

			VStack(alignment: .leading, spacing: 12) {
				SecureField("Backup password", text: $password)
					.textFieldStyle(.roundedBorder)
					.focused($focusedField, equals: .password)
					.disabled(isWorking)

				SecureField("Confirm password", text: $confirmPassword)
					.textFieldStyle(.roundedBorder)
					.focused($focusedField, equals: .confirm)
					.disabled(isWorking)
					.onSubmit { Task { await runBackup() } }
			}

			if let localError {
				InlineStatusMessage(message: localError, tone: .error, font: .caption)
			}

			HStack {
				Spacer()
				Button("Cancel", role: .cancel) {
					onDismiss()
				}
				.disabled(isWorking)

				Button {
					Task { await runBackup() }
				} label: {
					if isWorking {
						ProgressView()
							.controlSize(.small)
							.frame(width: 16, height: 16)
					} else {
						Text("Choose Location…")
					}
				}
				.keyboardShortcut(.defaultAction)
				.disabled(isWorking || !canSubmit)
			}
		}
		.padding(24)
		.frame(width: 420)
		.background(SettingsDesign.canvasBackground)
		.onAppear { focusedField = .password }
	}

	private var canSubmit: Bool {
		!password.isEmpty && password == confirmPassword
	}

	@MainActor
	private func runBackup() async {
		localError = nil
		guard !password.isEmpty else {
			localError = "Enter a backup password."
			return
		}
		guard password == confirmPassword else {
			localError = "Passwords do not match."
			return
		}

		isWorking = true
		defer { isWorking = false }

		do {
			let client = TobyClient()
			let result = try await client.createConfigBackup(password: password)

			guard let url = presentSavePanel(suggestedName: result.suggestedFileName) else {
				return
			}
			try result.backupData.write(to: url, options: .atomic)
			onSuccess(url.path)
			onDismiss()
		} catch {
			let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
			localError = message
			onError(message)
		}
	}

	@MainActor
	private func presentSavePanel(suggestedName: String) -> URL? {
		let panel = NSSavePanel()
		panel.canCreateDirectories = true
		panel.isExtensionHidden = false
		panel.nameFieldStringValue = suggestedName
		panel.allowedContentTypes = [UTType(filenameExtension: "tbybak") ?? .json]
		panel.message = "Choose where to save the Toby backup"
		panel.prompt = "Save Backup"
		let response = panel.runModal()
		return response == .OK ? panel.url : nil
	}
}

/// Sheet: restore settings from a chosen `.tbybak` file.
struct ConfigRestoreSheet: View {
	let backupURL: URL
	let onDismiss: () -> Void
	let onSuccess: () -> Void
	let onError: (String) -> Void

	@State private var password = ""
	@State private var isWorking = false
	@State private var localError: String?
	@State private var needsPassword = true
	@FocusState private var passwordFocused: Bool

	var body: some View {
		VStack(alignment: .leading, spacing: 20) {
			Text("Restore Toby Data")
				.font(.title2.weight(.bold))
				.foregroundStyle(AppTheme.primaryText)

			Text(
				"Restoring replaces your settings, credentials, chats, schedules, flows, projects, and memories. Toby restarts to apply database data. This cannot be undone without another backup."
			)
			.font(.subheadline)
			.foregroundStyle(AppTheme.secondaryText)
			.fixedSize(horizontal: false, vertical: true)

			Text(backupURL.lastPathComponent)
				.font(.caption.monospaced())
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(2)
				.truncationMode(.middle)

			if needsPassword {
				SecureField("Backup password", text: $password)
					.textFieldStyle(.roundedBorder)
					.focused($passwordFocused)
					.disabled(isWorking)
					.onSubmit { Task { await runRestore() } }
			}

			if let localError {
				InlineStatusMessage(message: localError, tone: .error, font: .caption)
			}

			HStack {
				Spacer()
				Button("Cancel", role: .cancel) {
					onDismiss()
				}
				.disabled(isWorking)

				Button(role: .destructive) {
					Task { await runRestore() }
				} label: {
					if isWorking {
						ProgressView()
							.controlSize(.small)
							.frame(width: 16, height: 16)
					} else {
						Text("Restore")
					}
				}
				.keyboardShortcut(.defaultAction)
				.disabled(isWorking || (needsPassword && password.isEmpty))
			}
		}
		.padding(24)
		.frame(width: 420)
		.background(SettingsDesign.canvasBackground)
		.onAppear {
			detectIfPasswordRequired()
			if needsPassword {
				passwordFocused = true
			}
		}
	}

	private func detectIfPasswordRequired() {
		guard
			let data = try? Data(contentsOf: backupURL),
			let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
		else {
			needsPassword = true
			return
		}
		// Encrypted envelope format uses version 2 + format marker.
		if json["format"] as? String == "toby.config.backup.encrypted" {
			needsPassword = true
		} else if json["version"] as? Int == 1 {
			// Legacy unencrypted payload
			needsPassword = false
		} else {
			needsPassword = true
		}
	}

	@MainActor
	private func runRestore() async {
		localError = nil
		isWorking = true
		defer { isWorking = false }

		do {
			let data = try Data(contentsOf: backupURL)
			let client = TobyClient()
			try await client.restoreConfigBackup(
				backupJSON: data,
				password: needsPassword ? password : nil,
				confirm: true
			)
			onSuccess()
			onDismiss()
		} catch {
			let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
			localError = message
			onError(message)
		}
	}
}

enum ConfigBackupFilePanels {
	/// Present an open panel for selecting a `.tbybak` backup file.
	@MainActor
	static func presentOpenPanel() -> URL? {
		let panel = NSOpenPanel()
		panel.canChooseFiles = true
		panel.canChooseDirectories = false
		panel.allowsMultipleSelection = false
		panel.allowedContentTypes = [UTType(filenameExtension: "tbybak") ?? .json]
		panel.message = "Choose a Toby backup file to restore"
		panel.prompt = "Choose"
		let response = panel.runModal()
		return response == .OK ? panel.url : nil
	}
}
