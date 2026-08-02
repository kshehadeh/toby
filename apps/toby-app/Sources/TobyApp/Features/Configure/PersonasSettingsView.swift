import SwiftUI

/// Personas management view for the Settings window: a sidebar list of
/// personas on the left and an inline editor detail pane on the right.
/// Supports creating, editing, and deleting personas.
struct PersonasSettingsView: View {
	@Bindable var store: ConfigureStore

	@State private var personas: [PersonaOption] = []
	@State private var selectedPersonaName: String?
	@State private var editorStore: PersonaEditorStore?
	@State private var isLoading = false
	@State private var listErrorMessage: String?
	@State private var pendingDelete: PersonaOption?

	private let client = TobyClient()

	var body: some View {
		HStack(spacing: 0) {
			sidebar
				.frame(width: 220)
				.frame(maxHeight: .infinity)
				.background(AppTheme.sidebarBackground)

			Divider()
				.background(AppTheme.separator)

			detailPane
				.frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity)
				.clipped()
		}
		.background(SettingsDesign.canvasBackground)
		.task {
			await loadPersonas()
			consumePendingSelection()
		}
		.onChange(of: store.pendingPersonaSelection) { _, _ in
			consumePendingSelection()
		}
		.onReceive(NotificationCenter.default.publisher(for: .personasDidChange)) { _ in
			Task { await loadPersonas() }
		}
		.alert(
			"Delete Persona?",
			isPresented: Binding(
				get: { pendingDelete != nil },
				set: { if !$0 { pendingDelete = nil } },
			),
		) {
			Button("Cancel", role: .cancel) {
				pendingDelete = nil
			}
			Button("Delete", role: .destructive) {
				if let persona = pendingDelete {
					Task { await deletePersona(persona) }
				}
			}
		} message: {
			Text("Are you sure you want to delete \"\(pendingDelete?.label ?? "")\"? This cannot be undone.")
		}
	}

	// MARK: - Sidebar

	private var sidebar: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("Personas")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 12)
				.padding(.top, 12)
				.padding(.bottom, 6)

			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if isLoading && personas.isEmpty {
						VStack(spacing: 8) {
							ForEach(0..<3, id: \.self) { _ in
								RoundedRectangle(cornerRadius: 8)
									.fill(SettingsDesign.sidebarSelection.opacity(0.3))
									.frame(height: 34)
									.padding(.horizontal, 4)
							}
						}
						.padding(.vertical, 4)
					} else {
						ForEach(personas) { persona in
							PersonaSettingsSidebarRow(
								persona: persona,
								isSelected: selectedPersonaName == persona.name,
								onSelect: { selectPersona(persona) },
							)
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.horizontal, 8)
				.padding(.bottom, 10)
			}

			Divider()
				.background(AppTheme.separator)
				.opacity(0.5)

			Button {
				startCreate()
			} label: {
				Label("Add Persona", systemImage: "plus.circle")
					.font(.callout.weight(.medium))
					.foregroundStyle(AppTheme.accent)
					.frame(maxWidth: .infinity, alignment: .leading)
					.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.padding(.horizontal, 12)
			.padding(.vertical, 10)
			.accessibilityIdentifier("personas-settings-add-button")
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}

	// MARK: - Detail pane

	@ViewBuilder
	private var detailPane: some View {
		if let currentStore = editorStore {
			PersonaEditorFormView(
				store: currentStore,
				showDeleteButton: canDeleteCurrentPersona,
				onDelete: {
					if let name = selectedPersonaName,
						let persona = personas.first(where: { $0.name == name })
					{
						pendingDelete = persona
					}
				},
				onSaved: {
					Task { await handleSaved() }
					NotificationCenter.default.post(name: .personasDidChange, object: nil)
				},
				onCancel: {
					if currentStore.mode.isCreate {
						editorStore = nil
						selectedPersonaName = nil
					}
				},
			)
		} else if isLoading {
			ProgressView("Loading…")
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		} else {
			ContentUnavailableView {
				Label("No Persona Selected", systemImage: "person.crop.circle")
			} description: {
				Text("Select a persona from the list to edit it, or click Add Persona to create a new one.")
			}
		}
	}

	private var canDeleteCurrentPersona: Bool {
		guard let editorStore, editorStore.mode.isEdit, !editorStore.isBuiltIn else {
			return false
		}
		return true
	}

	// MARK: - Actions

	private func selectPersona(_ persona: PersonaOption) {
		selectedPersonaName = persona.name
		editorStore = PersonaEditorStore(mode: .edit(name: persona.name))
	}

	private func startCreate() {
		selectedPersonaName = nil
		editorStore = PersonaEditorStore(mode: .create)
	}

	private func handleSaved() async {
		let savedName = editorStore?.name
		await loadPersonas()
		// After creating a new persona, switch to edit mode for it so the
		// user can continue tweaking (e.g. uploading an image).
		if let savedName, editorStore?.mode.isCreate == true,
			personas.contains(where: { $0.name == savedName })
		{
			selectedPersonaName = savedName
			editorStore = PersonaEditorStore(mode: .edit(name: savedName))
		}
	}

	private func deletePersona(_ persona: PersonaOption) async {
		let store = PersonaEditorStore(mode: .edit(name: persona.name))
		await store.load()
		await store.delete()
		if case .saved = store.saveState {
			await loadPersonas()
			if selectedPersonaName == persona.name {
				selectedPersonaName = nil
				editorStore = nil
			}
			NotificationCenter.default.post(name: .personasDidChange, object: nil)
		} else if let error = store.errorMessage {
			listErrorMessage = error
		}
	}

	// MARK: - Data

	private func loadPersonas() async {
		guard !isLoading else { return }
		isLoading = true
		listErrorMessage = nil
		defer { isLoading = false }
		do {
			personas = try await client.listPersonas()
		} catch {
			listErrorMessage = error.localizedDescription
		}
	}

	private func consumePendingSelection() {
		guard let name = store.pendingPersonaSelection else { return }
		store.pendingPersonaSelection = nil
		selectedPersonaName = name
		editorStore = PersonaEditorStore(mode: .edit(name: name))
	}
}

// MARK: - Sidebar row

private struct PersonaSettingsSidebarRow: View {
	let persona: PersonaOption
	let isSelected: Bool
	let onSelect: () -> Void

	@State private var isHovered = false

	private var imageURL: URL {
		let base = ConfigReader.baseURL().absoluteString
		if let imageUrlString = persona.imageUrl,
			let url = URL(string: base + imageUrlString)
		{
			return url
		}
		return ConfigReader.baseURL()
			.appendingPathComponent("api/personas/image/default.png")
	}

	private var iconColor: Color {
		if isSelected { return AppTheme.accent }
		if isHovered { return AppTheme.primaryText }
		return AppTheme.tertiaryText
	}

	private var labelColor: Color {
		if isSelected || isHovered { return AppTheme.primaryText }
		return AppTheme.secondaryText
	}

	private var backgroundFill: Color {
		if isSelected {
			return AppTheme.accent.opacity(0.18)
		}
		if isHovered { return SettingsDesign.sidebarSelection.opacity(0.7) }
		return .clear
	}

	var body: some View {
		Button {
			onSelect()
		} label: {
			HStack(spacing: 10) {
				RoundedRectangle(cornerRadius: 1.5)
					.fill(isSelected ? AppTheme.accent : Color.clear)
					.frame(width: 3, height: 18)
					.accessibilityHidden(true)

				PersonaImageView(url: imageURL, size: 22)
					.accessibilityHidden(true)

				Text(persona.label)
					.font(.callout.weight(isSelected ? .semibold : .medium))
					.foregroundStyle(labelColor)
					.lineLimit(1)

				Spacer(minLength: 0)

				if persona.isDefault == true {
					Image(systemName: "star.fill")
						.font(.system(size: 10))
						.foregroundStyle(AppTheme.accent.opacity(0.7))
						.accessibilityLabel("Default persona")
				}

				if persona.isBuiltIn == true {
					Text("Built-in")
						.font(.caption2)
						.foregroundStyle(AppTheme.tertiaryText)
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.vertical, 7)
			.padding(.trailing, 8)
			.padding(.leading, 5)
			.contentShape(Rectangle())
			.background(
				RoundedRectangle(cornerRadius: 8)
					.fill(backgroundFill)
			)
		}
		.buttonStyle(.plain)
		.onHover { isHovered = $0 }
		.accessibilityAddTraits(isSelected ? .isSelected : [])
		.accessibilityIdentifier("personas-settings-row-\(persona.name)")
	}
}
