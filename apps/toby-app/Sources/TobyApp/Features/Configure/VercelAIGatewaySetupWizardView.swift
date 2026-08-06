import AppKit
import SwiftUI

/// Guided first-run setup for an AI provider that exposes the generic
/// `/api/ai/providers/:id/setup` contract. Currently used for Vercel AI Gateway
/// onboarding; other adapters can reuse the same view with a different `providerId`.
struct VercelAIGatewaySetupWizardView: View {
	/// Provider id matching a server-side setup adapter (e.g. `"vercel"`).
	var providerId: String = "vercel"
	var onCompleted: (() -> Void)?
	var onDismiss: () -> Void

	@State private var guide: AIProviderSetupGuide?
	@State private var isLoadingGuide = true
	@State private var guideError: String?
	@State private var fieldValues: [String: String] = [:]
	@State private var isSubmitting = false
	@State private var submitError: String?
	@State private var successMessage: String?
	@FocusState private var focusedFieldKey: String?

	private let client = TobyClient()

	private var requiredFieldsFilled: Bool {
		guard let guide else { return false }
		for field in guide.fields where field.required != false {
			let value = fieldValues[field.key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			if value.isEmpty { return false }
		}
		return !guide.fields.isEmpty
	}

	private var canSubmit: Bool {
		requiredFieldsFilled && !isSubmitting && successMessage == nil
	}

	var body: some View {
		VStack(spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 24) {
					header
					if isLoadingGuide {
						HStack(spacing: 8) {
							ProgressView()
								.controlSize(.small)
							Text("Loading setup guide…")
								.font(.subheadline)
								.foregroundStyle(AppTheme.secondaryText)
						}
					} else if let guideError {
						InlineStatusMessage(message: guideError, tone: .error)
					} else if let guide {
						if let description = guide.description, !description.isEmpty {
							Text(description)
								.font(.subheadline)
								.foregroundStyle(AppTheme.secondaryText)
								.fixedSize(horizontal: false, vertical: true)
						}
						stepsSection(guide.steps)
						fieldsSection(guide)
					}
				}
				.padding(24)
			}

			Divider()
				.background(SettingsDesign.controlBorder)

			footer
		}
		.frame(minWidth: 560, idealWidth: 620, minHeight: 520)
		.background(SettingsDesign.canvasBackground)
		.task(id: providerId) {
			await loadGuide()
		}
		.accessibilityIdentifier("ai-provider-setup-wizard")
	}

	@ViewBuilder
	private var header: some View {
		HStack(spacing: 14) {
			RoundedRectangle(cornerRadius: 12)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 48, height: 48)
				.overlay {
					Image(systemName: "bolt.horizontal.circle.fill")
						.font(.system(size: 22, weight: .medium))
						.foregroundStyle(AppTheme.accent)
						.accessibilityHidden(true)
				}
			VStack(alignment: .leading, spacing: 4) {
				Text(guide?.displayName ?? "AI provider setup")
					.font(.title3.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				if guide?.meta?.recommended == true {
					Text("Recommended for new Toby installs")
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
				}
			}
			Spacer()
		}
	}

	private func stepsSection(_ steps: [AIProviderSetupGuideStep]) -> some View {
		VStack(alignment: .leading, spacing: 16) {
			Text("Setup steps")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)

			ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
				VStack(alignment: .leading, spacing: 8) {
					HStack(alignment: .top, spacing: 10) {
						Text("\(index + 1)")
							.font(.caption.weight(.semibold))
							.foregroundStyle(AppTheme.accent)
							.frame(width: 22, height: 22)
							.background(
								Circle()
									.fill(AppTheme.accent.opacity(0.12))
							)
						Text(step.title)
							.font(.subheadline.weight(.semibold))
							.foregroundStyle(AppTheme.primaryText)
					}
					if let description = step.description, !description.isEmpty {
						Text(description)
							.font(.subheadline)
							.foregroundStyle(AppTheme.secondaryText)
							.fixedSize(horizontal: false, vertical: true)
							.padding(.leading, 32)
					}
					if let urlString = step.url,
						let url = URL(string: urlString),
						let label = step.urlLabel
					{
						Button {
							NSWorkspace.shared.open(url)
						} label: {
							HStack(spacing: 6) {
								Image(systemName: "arrow.up.right.square")
									.font(.caption)
								Text(label)
									.font(.subheadline.weight(.medium))
							}
							.foregroundStyle(AppTheme.accent)
						}
						.buttonStyle(.plain)
						.padding(.leading, 32)
						.accessibilityIdentifier("ai-provider-setup-link-\(step.id)")
					}
				}
			}
		}
	}

	private func fieldsSection(_ guide: AIProviderSetupGuide) -> some View {
		VStack(alignment: .leading, spacing: 12) {
			Text("Credentials")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)

			if let defaultModel = guide.defaultModel, !defaultModel.isEmpty {
				Text(
					"Toby stores credentials securely, validates them with the provider, and sets the Toby persona to \(defaultModel)."
				)
				.font(.subheadline)
				.foregroundStyle(AppTheme.secondaryText)
				.fixedSize(horizontal: false, vertical: true)
			}

			ForEach(guide.fields) { field in
				VStack(alignment: .leading, spacing: 6) {
					Text(field.label)
						.font(.subheadline.weight(.medium))
						.foregroundStyle(AppTheme.primaryText)
					if field.secret == true {
						SecureField(field.placeholder ?? "", text: binding(for: field.key))
							.textFieldStyle(.roundedBorder)
							.focused($focusedFieldKey, equals: field.key)
							.disabled(isSubmitting || successMessage != nil)
							.accessibilityIdentifier("ai-provider-setup-field-\(field.key)")
					} else {
						TextField(field.placeholder ?? "", text: binding(for: field.key))
							.textFieldStyle(.roundedBorder)
							.focused($focusedFieldKey, equals: field.key)
							.disabled(isSubmitting || successMessage != nil)
							.accessibilityIdentifier("ai-provider-setup-field-\(field.key)")
					}
				}
			}

			if let submitError {
				InlineStatusMessage(message: submitError, tone: .error, font: .caption)
					.accessibilityIdentifier("ai-provider-setup-error")
			}
			if let successMessage {
				InlineStatusMessage(message: successMessage, tone: .success)
					.accessibilityIdentifier("ai-provider-setup-success")
			}
		}
		.onAppear {
			if let first = guide.fields.first {
				focusedFieldKey = first.key
			}
		}
	}

	private func binding(for key: String) -> Binding<String> {
		Binding(
			get: { fieldValues[key] ?? "" },
			set: { fieldValues[key] = $0 }
		)
	}

	private var footer: some View {
		HStack(spacing: 12) {
			Button("Use another provider…") {
				onDismiss()
				// RootView reads the nav key from `object` (see openSettingsWindow handler).
				NotificationCenter.default.post(
					name: .openSettingsWindow,
					object: "ai"
				)
			}
			.disabled(isSubmitting)
			.accessibilityIdentifier("ai-provider-setup-other-provider")

			Spacer()

			Button("Cancel") {
				onDismiss()
			}
			.keyboardShortcut(.escape, modifiers: [])
			.disabled(isSubmitting)

			if successMessage != nil {
				Button("Done") {
					onCompleted?()
					onDismiss()
				}
				.buttonStyle(.borderedProminent)
				.keyboardShortcut(.defaultAction)
				.accessibilityIdentifier("ai-provider-setup-done")
			} else {
				Button {
					Task { await submit() }
				} label: {
					if isSubmitting {
						HStack(spacing: 8) {
							ProgressView()
								.controlSize(.small)
							Text("Validating…")
						}
					} else {
						Text("Validate & connect")
					}
				}
				.buttonStyle(.borderedProminent)
				.disabled(!canSubmit)
				.keyboardShortcut(.defaultAction)
				.accessibilityIdentifier("ai-provider-setup-submit")
			}
		}
		.padding(16)
	}

	private func loadGuide() async {
		isLoadingGuide = true
		guideError = nil
		defer { isLoadingGuide = false }
		do {
			let loaded = try await client.fetchAIProviderSetupGuide(providerId: providerId)
			guide = loaded
			seedFieldDefaults(from: loaded)
		} catch {
			guide = nil
			guideError = error.localizedDescription
		}
	}

	private func seedFieldDefaults(from guide: AIProviderSetupGuide) {
		var next = fieldValues
		for field in guide.fields where next[field.key] == nil {
			next[field.key] = ""
		}
		fieldValues = next
	}

	private func submit() async {
		guard let guide else { return }
		var fields: [String: String] = [:]
		for field in guide.fields {
			let value = fieldValues[field.key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			if field.required != false && value.isEmpty {
				submitError = "\(field.label) is required."
				return
			}
			if !value.isEmpty {
				fields[field.key] = value
			}
		}

		isSubmitting = true
		submitError = nil
		successMessage = nil
		defer { isSubmitting = false }

		do {
			let result = try await client.setupAIProvider(
				providerId: providerId,
				fields: fields,
				model: guide.defaultModel
			)
			var message = "Connected"
			if let model = result.model, !model.isEmpty {
				message += ". Toby persona uses \(model)"
			}
			message += "."
			if let remaining = result.remaining ?? result.details?.remaining {
				message += String(format: " Balance ≈ $%.2f.", remaining)
			}
			successMessage = message
			onCompleted?()
		} catch {
			submitError = error.localizedDescription
		}
	}
}
