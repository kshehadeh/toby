import SwiftUI

struct AppSidebar: View {
	let sessions: [SessionSummary]
	let selectedSessionId: String?
	let status: AppStatus?
	let isLoading: Bool
	let isSessionsLoading: Bool
	let onNewChat: () -> Void
	let onSearch: () -> Void
	let onSelectSession: (String) -> Void
	let onOpenSettings: (String?) -> Void
	let onOpenPersonasSettings: () -> Void
	let onPersonaSelected: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			SidebarHeader(status: status)
			SidebarPrimaryActions(
				onNewChat: onNewChat,
				onSearch: onSearch,
				isLoading: isLoading,
			)
			SidebarSection(title: "Workspace") {
				if isSessionsLoading && sessions.isEmpty {
					Text("Loading sessions…")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(.horizontal, 8)
						.padding(.vertical, 7)
				} else if sessions.isEmpty {
					Text("No past sessions")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(.horizontal, 8)
						.padding(.vertical, 7)
				} else {
					ScrollView {
						VStack(alignment: .leading, spacing: 2) {
							ForEach(sessions) { session in
								Button {
									onSelectSession(session.id)
								} label: {
									SidebarRow(
										title: session.name,
										systemImage: "message",
										isSelected: session.id == selectedSessionId,
									)
								}
								.buttonStyle(.plain)
								.frame(maxWidth: .infinity, alignment: .leading)
								.disabled(isLoading)
							}
						}
					}
					.frame(maxHeight: 220)
				}
			}
			SidebarSection(title: "Toby") {
				Button {
					onOpenSettings("integrations")
				} label: {
					SidebarRow(title: "Plugins", systemImage: "square.grid.2x2")
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onOpenSettings("schedules")
				} label: {
					SidebarRow(title: "Schedules", systemImage: "clock")
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onOpenSettings(nil)
				} label: {
					SidebarRow(title: "Settings", systemImage: "gearshape")
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			Spacer(minLength: AppTheme.contentPadding)
			SidebarFooter(
				status: status,
				onOpenPersonasSettings: onOpenPersonasSettings,
				onPersonaSelected: onPersonaSelected,
			)
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 12)
		.frame(width: AppTheme.sidebarWidth)
		.background(AppTheme.sidebarBackground)
		.overlay(alignment: .trailing) {
			Rectangle()
				.fill(AppTheme.separator)
				.frame(width: 1)
		}
	}
}

private struct SidebarHeader: View {
	let status: AppStatus?

	var body: some View {
		HStack(spacing: 8) {
			Circle()
				.fill(AppTheme.accent)
				.frame(width: 10, height: 10)
			Text("Toby")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
			Spacer()
			if let version = status?.version {
				Text("v\(version)")
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
		.padding(.horizontal, 8)
		.padding(.bottom, 14)
	}
}

private struct SidebarPrimaryActions: View {
	let onNewChat: () -> Void
	let onSearch: () -> Void
	let isLoading: Bool

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Button(action: onNewChat) {
				Label("New chat", systemImage: "square.and.pencil")
					.frame(maxWidth: .infinity, alignment: .leading)
					.contentShape(Rectangle())
			}
			.buttonStyle(SidebarButtonStyle())
			.disabled(isLoading)
			Button(action: onSearch) {
				Label("Search", systemImage: "magnifyingglass")
					.frame(maxWidth: .infinity, alignment: .leading)
					.contentShape(Rectangle())
			}
			.buttonStyle(SidebarButtonStyle())
		}
		.padding(.bottom, 14)
	}
}

private struct SidebarSection<Content: View>: View {
	let title: String
	@ViewBuilder let content: Content

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text(title)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 8)
				.padding(.top, 10)
			content
		}
	}
}

private struct SidebarRow: View {
	let title: String
	let systemImage: String
	var isSelected = false

	var body: some View {
		Label(title, systemImage: systemImage)
			.font(.callout)
			.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
			.lineLimit(1)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.horizontal, 8)
			.padding(.vertical, 7)
			.contentShape(Rectangle())
			.background(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(isSelected ? AppTheme.selection : Color.clear)
			)
	}
}

private struct SidebarFooter: View {
	let status: AppStatus?
	let onOpenPersonasSettings: () -> Void
	let onPersonaSelected: () -> Void

	@State private var isPersonaPickerPresented = false

	var body: some View {
		Button {
			isPersonaPickerPresented = true
		} label: {
			HStack(alignment: .center, spacing: 8) {
				VStack(alignment: .leading, spacing: 4) {
					Text(status?.persona ?? "Connecting")
						.font(.callout)
						.foregroundStyle(AppTheme.primaryText)
					Text(status?.model ?? "Waiting for daemon")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
				Spacer(minLength: 0)
				Image(systemName: "chevron.up.chevron.down")
					.font(.caption2.weight(.semibold))
					.foregroundStyle(AppTheme.tertiaryText)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.padding(8)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(isPersonaPickerPresented ? AppTheme.selection : Color.clear)
		)
		.popover(isPresented: $isPersonaPickerPresented, arrowEdge: .bottom) {
			PersonaPickerPopover(
				currentPersona: status?.persona,
				onOpenPersonasSettings: {
					isPersonaPickerPresented = false
					onOpenPersonasSettings()
				},
				onPersonaSelected: {
					isPersonaPickerPresented = false
					onPersonaSelected()
				},
			)
		}
		.accessibilityLabel("Persona")
		.accessibilityValue(status?.persona ?? "Connecting")
	}
}

private struct PersonaPickerPopover: View {
	let currentPersona: String?
	let onOpenPersonasSettings: () -> Void
	let onPersonaSelected: () -> Void

	@State private var personas: [PersonaOption] = []
	@State private var isLoading = false
	@State private var isSaving = false
	@State private var errorMessage: String?

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
						Button {
							selectPersona(persona)
						} label: {
							HStack(spacing: 8) {
								if persona.name == currentPersona {
									Image(systemName: "checkmark")
										.frame(width: 14)
								} else {
									Color.clear
										.frame(width: 14, height: 1)
								}
								Text(persona.label)
									.lineLimit(1)
								Spacer(minLength: 0)
							}
							.frame(maxWidth: .infinity, alignment: .leading)
							.contentShape(Rectangle())
						}
						.buttonStyle(.plain)
						.padding(.horizontal, 6)
						.padding(.vertical, 5)
						.disabled(isSaving)
					}
				}
			}

			Divider()

			Button {
				onOpenPersonasSettings()
			} label: {
				Label("Configure Personas...", systemImage: "gearshape")
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
		.frame(width: 240)
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

private struct SidebarButtonStyle: ButtonStyle {
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.callout)
			.foregroundStyle(AppTheme.primaryText)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.horizontal, 8)
			.padding(.vertical, 7)
			.contentShape(Rectangle())
			.background(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(configuration.isPressed ? AppTheme.selection : Color.clear)
			)
	}
}
