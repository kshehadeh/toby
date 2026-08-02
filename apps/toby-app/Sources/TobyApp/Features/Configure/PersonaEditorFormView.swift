import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Reusable persona editor form (header + content + footer). Used both by the
/// standalone `PersonaEditorView` window and the inline `PersonasSettingsView`
/// detail pane.
struct PersonaEditorFormView: View {
	@Bindable var store: PersonaEditorStore
	var showDeleteButton: Bool = false
	var showCancelButton: Bool = true
	var onDelete: (() -> Void)? = nil
	let onSaved: () -> Void
	var onCancel: (() -> Void)? = nil

	@State private var isImagePickerPresented = false
	@State private var showResetImageConfirm = false

	var body: some View {
		VStack(spacing: 0) {
			header
			content
			footer
		}
		.background(SettingsDesign.canvasBackground)
		.task(id: store.id) {
			await store.load()
		}
	}

	private var header: some View {
		HStack {
			Text(store.mode.isCreate ? "New Persona" : "Edit Persona")
				.font(.title3.weight(.semibold))
				.foregroundStyle(AppTheme.primaryText)
			Spacer()
			if showDeleteButton, let onDelete {
				Button(role: .destructive) {
					onDelete()
				} label: {
					Label("Delete", systemImage: "trash")
						.font(.callout)
				}
				.buttonStyle(.plain)
				.foregroundStyle(.red)
				.disabled(store.saveState == .saving)
				.accessibilityIdentifier("persona-editor-delete-button")
			}
		}
		.padding(.horizontal, 20)
		.padding(.top, 20)
		.padding(.bottom, 16)
	}

	@ViewBuilder
	private var content: some View {
		if store.isLoading && store.providers.isEmpty {
			ProgressView("Loading…")
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		} else {
			ScrollView {
				VStack(alignment: .leading, spacing: 20) {
					if store.canEditImage {
						imageSection
					}
					nameField
					instructionsEditor
					providerModelRow
					promptModeRow
				}
				.padding(.horizontal, 20)
				.padding(.bottom, 20)
			}
		}
	}

	private var imageSection: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Icon")
				.font(.subheadline.weight(.medium))
				.foregroundStyle(SettingsDesign.sectionHeader)
			HStack(spacing: 16) {
				PersonaImageView(url: store.displayImageURL, size: 56)
				VStack(alignment: .leading, spacing: 8) {
					Text(store.hasCustomImage ? "Custom image" : "Default image")
						.font(.subheadline)
						.foregroundStyle(SettingsDesign.rowDescription)
					HStack(spacing: 10) {
						SettingsActionButton(title: "Choose Image…", showsExternalIcon: false) {
							isImagePickerPresented = true
						}
						.disabled(store.isSavingImage)
						if store.hasCustomImage {
							SettingsActionButton(title: "Reset to Default", showsExternalIcon: false) {
								showResetImageConfirm = true
							}
							.disabled(store.isSavingImage)
						}
					}
				}
				Spacer(minLength: 0)
			}
		}
		.fileImporter(
			isPresented: $isImagePickerPresented,
			allowedContentTypes: [.png, .jpeg, .image],
			allowsMultipleSelection: false,
		) { result in
			handleImagePickerResult(result)
		}
		.alert("Reset Image?", isPresented: $showResetImageConfirm) {
			Button("Cancel", role: .cancel) {}
			Button("Reset", role: .destructive) {
				Task { await store.resetImage() }
			}
		} message: {
			Text("This will remove the custom image and use the default persona image.")
		}
	}

	private func handleImagePickerResult(_ result: Result<[URL], Error>) {
		switch result {
		case .success(let urls):
			guard let url = urls.first else { return }
			Task {
				do {
					let accessed = url.startAccessingSecurityScopedResource()
					defer {
						if accessed { url.stopAccessingSecurityScopedResource() }
					}
					let data = try Data(contentsOf: url)
					await store.uploadImage(fileData: data, filename: url.lastPathComponent)
				} catch {
					store.errorMessage = error.localizedDescription
				}
			}
		case .failure(let error):
			store.errorMessage = error.localizedDescription
		}
	}

	private var nameField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Name")
				.font(.subheadline.weight(.medium))
				.foregroundStyle(SettingsDesign.sectionHeader)
			TextField("Persona name", text: $store.name)
				.textFieldStyle(.roundedBorder)
				.controlSize(.regular)
				.disabled(!store.isNameEditable)
		}
	}

	private var instructionsEditor: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Instructions")
				.font(.subheadline.weight(.medium))
				.foregroundStyle(SettingsDesign.sectionHeader)
			MarkdownEditor(text: $store.instructions)
				.frame(minHeight: 180, maxHeight: .infinity)
				.disabled(!store.canEditPersonaDefinition)
		}
	}

	private var providerModelRow: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack(spacing: 16) {
				VStack(alignment: .leading, spacing: 6) {
					Text("Provider")
						.font(.subheadline.weight(.medium))
						.foregroundStyle(SettingsDesign.sectionHeader)
					providerMenu
				}
				VStack(alignment: .leading, spacing: 6) {
					Text("Model")
						.font(.subheadline.weight(.medium))
						.foregroundStyle(SettingsDesign.sectionHeader)
					modelMenu
				}
			}
			if let message = store.providerValidationMessage {
				Text(message)
					.font(.caption)
					.foregroundStyle(store.hasConfiguredProviders ? .orange : .red)
					.fixedSize(horizontal: false, vertical: true)
			}
		}
	}

	private var providerMenu: some View {
		SettingsSelectChoiceField(
			title: "Provider",
			choices: store.hasConfiguredProviders
				? store.providers.filter { $0.configured }.map {
					SettingsSelectChoice(value: $0.providerId, label: $0.displayName)
				}
				: store.providers.map {
					SettingsSelectChoice(value: $0.providerId, label: $0.displayName)
				},
			selection: providerBinding,
		)
		.frame(maxWidth: .infinity, alignment: .leading)
		.disabled(!store.hasConfiguredProviders)
	}

	private var modelMenu: some View {
		SettingsSelectChoiceField(
			title: "Model",
			choices: store.availableModels.map {
				SettingsSelectChoice(value: $0.id, label: $0.pickerLabel)
			},
			selection: $store.model,
		)
		.frame(maxWidth: .infinity, alignment: .leading)
		.disabled(!store.hasConfiguredProviders || !store.isSelectedProviderConfigured)
	}

	private var providerBinding: Binding<String> {
		Binding(
			get: { store.provider },
			set: { providerId in
				store.provider = providerId
				if let provider = store.providers.first(where: { $0.providerId == providerId }),
					let firstModel = provider.models.first
				{
					store.model = firstModel.id
				}
			},
		)
	}

	private var promptModeRow: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Prompt Mode")
				.font(.subheadline.weight(.medium))
				.foregroundStyle(SettingsDesign.sectionHeader)
			Picker("Prompt Mode", selection: $store.promptMode) {
				Text("Add").tag("add")
				Text("Replace").tag("replace")
			}
			.pickerStyle(.segmented)
			.labelsHidden()
			.frame(width: 200)
			.disabled(!store.canEditPersonaDefinition)
		}
	}

	private var footer: some View {
		HStack(spacing: 12) {
			if let errorMessage = store.errorMessage {
				Text(errorMessage)
					.font(.caption)
					.foregroundStyle(.red)
					.lineLimit(2)
					.frame(maxWidth: .infinity, alignment: .leading)
			} else {
				Spacer()
			}
			if showCancelButton, let onCancel {
				Button("Cancel") {
					onCancel()
				}
				.buttonStyle(.plain)
				.foregroundStyle(SettingsDesign.rowDescription)
				.disabled(store.saveState == .saving)
			}
			Button(store.mode.isCreate ? "Create" : "Save") {
				Task {
					await store.save()
					if case .saved = store.saveState {
						onSaved()
					}
				}
			}
			.disabled(!store.canSave)
			.buttonStyle(.borderedProminent)
		}
		.padding(.horizontal, 20)
		.padding(.vertical, 16)
		.overlay(alignment: .top) {
			Rectangle()
				.fill(SettingsDesign.cardBorder)
				.frame(height: 1)
		}
	}
}
