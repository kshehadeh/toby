import SwiftUI

struct PersonaPickerPopover: View {
	let currentPersona: String?
	/// When true (e.g. onboarding), pulse-highlight the create action.
	var emphasizeCreate: Bool = false
	let onCreatePersona: () -> Void
	let onEditPersona: (String) -> Void
	let onPersonaSelected: () -> Void

	@State private var personas: [PersonaOption] = []
	@State private var isLoading = false
	@State private var isSaving = false
	@State private var errorMessage: String?
	@State private var hoveredPersonaId: String?
	@State private var createPulse = false

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
				Label("Manage Personas…", systemImage: "person.crop.circle.badge.gearshape")
					.frame(maxWidth: .infinity, alignment: .leading)
					.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.padding(.horizontal, 8)
			.padding(.vertical, 7)
			.background(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(emphasizeCreate ? AppTheme.accent.opacity(createPulse ? 0.22 : 0.12) : Color.clear)
			)
			.overlay {
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.stroke(
						emphasizeCreate ? AppTheme.accent.opacity(createPulse ? 0.95 : 0.40) : Color.clear,
						lineWidth: emphasizeCreate ? 1.5 : 0
					)
					.shadow(
						color: emphasizeCreate ? AppTheme.accent.opacity(createPulse ? 0.55 : 0.20) : .clear,
						radius: createPulse ? 10 : 4
					)
			}
			.scaleEffect(emphasizeCreate && createPulse ? 1.02 : 1.0)
			.animation(
				emphasizeCreate
					? .easeInOut(duration: 0.85).repeatForever(autoreverses: true)
					: .default,
				value: createPulse
			)
			.accessibilityIdentifier("persona-picker-manage-personas")

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
		.onReceive(NotificationCenter.default.publisher(for: .personasDidChange)) { _ in
			Task { await loadPersonas() }
		}
		.onAppear {
			guard emphasizeCreate else { return }
			createPulse = false
			DispatchQueue.main.async {
				createPulse = true
			}
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
