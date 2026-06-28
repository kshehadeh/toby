import SwiftUI

struct PersonaPickerPopover: View {
	let currentPersona: String?
	let onCreatePersona: () -> Void
	let onEditPersona: (String) -> Void
	let onPersonaSelected: () -> Void

	@State private var personas: [PersonaOption] = []
	@State private var isLoading = false
	@State private var isSaving = false
	@State private var errorMessage: String?
	@State private var hoveredPersonaId: String?

	private let client = TobyClient()

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Select Persona")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)

			if isLoading && personas.isEmpty {
				ProgressView("Loading personas...")
					.controlSize(.small)
			} else {
				VStack(alignment: .leading, spacing: 2) {
					ForEach(personas) { persona in
						PersonaPickerRow(
							persona: persona,
							isCurrent: persona.name == currentPersona,
							isSaving: isSaving,
							isHovered: hoveredPersonaId == persona.id,
							onHoverChange: { isHovered in
								if isHovered {
									hoveredPersonaId = persona.id
								} else if hoveredPersonaId == persona.id {
									hoveredPersonaId = nil
								}
							},
							onSelect: { selectPersona(persona) },
							onEdit: { onEditPersona(persona.name) },
						)
					}
				}
			}

			Divider()

			Button {
				onCreatePersona()
			} label: {
				Label("Add New Persona…", systemImage: "plus.circle")
					.frame(maxWidth: .infinity, alignment: .leading)
					.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.padding(.horizontal, 6)
			.padding(.vertical, 5)

			if let errorMessage {
				Text(errorMessage)
					.font(.caption)
					.foregroundStyle(.red)
					.fixedSize(horizontal: false, vertical: true)
			}
		}
		.padding(12)
		.frame(width: 260)
		.task {
			await loadPersonas()
		}
	}

	private func loadPersonas() async {
		guard !isLoading else { return }
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			personas = try await client.listPersonas()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	private func selectPersona(_ persona: PersonaOption) {
		guard persona.name != currentPersona, !isSaving else { return }
		Task {
			isSaving = true
			errorMessage = nil
			defer { isSaving = false }
			do {
				_ = try await client.runConfigureAction(
					"set-default-persona",
					body: ["personaName": persona.name],
				)
				onPersonaSelected()
			} catch {
				errorMessage = error.localizedDescription
			}
		}
	}
}
