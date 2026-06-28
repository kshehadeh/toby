import AppKit
import SwiftUI

struct AppSidebar<Content: View>: View {
	let currentRoute: DetailRoute
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let updateStore: UpdateStore?
	let onSelectRoute: (DetailRoute) -> Void
	let onCreatePersona: () -> Void
	let onEditPersona: (String) -> Void
	let onPersonaSelected: () -> Void
	let onOpenChangelog: () -> Void
	@ViewBuilder let sidebarContent: () -> Content

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			SidebarHeader(status: status, daemonStatus: daemonStatus, updateStore: updateStore, onOpenChangelog: onOpenChangelog)
			sidebarContent()
				.frame(maxHeight: .infinity)
				.padding(.bottom, 16)
			Divider()
				.background(AppTheme.separator)
				.opacity(0.5)
				.padding(.vertical, 2)
			VStack(alignment: .leading, spacing: 4) {
				Button {
					onSelectRoute(.chat)
				} label: {
					SidebarRow(title: "Chats", systemImage: "message", isSelected: currentRoute == .chat)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onSelectRoute(.integrations)
				} label: {
					SidebarRow(title: "Integrations", systemImage: "square.grid.2x2", isSelected: currentRoute == .integrations)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onSelectRoute(.skills)
				} label: {
					SidebarRow(title: "Skills", systemImage: "wand.and.stars", isSelected: currentRoute == .skills)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onSelectRoute(.schedules)
				} label: {
					SidebarRow(title: "Schedules", systemImage: "clock", isSelected: currentRoute == .schedules)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onSelectRoute(.recordings)
				} label: {
					SidebarRow(title: "Recordings", systemImage: "waveform", isSelected: currentRoute == .recordings)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onSelectRoute(.settings)
				} label: {
					SidebarRow(title: "Settings", systemImage: "gearshape", isSelected: currentRoute == .settings)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			.padding(.top, 6)
			.padding(.bottom, 8)
			Divider()
				.background(AppTheme.separator)
				.opacity(0.5)
				.padding(.vertical, 2)
			SidebarFooter(
				status: status,
				onCreatePersona: onCreatePersona,
				onEditPersona: onEditPersona,
				onPersonaSelected: onPersonaSelected,
			)
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 12)
		.frame(minWidth: AppTheme.minSidebarWidth, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.background(AppTheme.sidebarBackground)
		.accessibilityIdentifier("app-sidebar")
	}
}

struct ChatSessionsSidebar: View {
	let sessions: [SessionSummary]
	let selectedSessionId: String?
	let isLoading: Bool
	let isSessionsLoading: Bool
	let onSelectSession: (String) -> Void
	let onDeleteSession: (SessionSummary) -> Void
	@State private var isWorkspaceScrolling = false
	@State private var workspaceScrollProgress: CGFloat = 0
	@State private var chatsHeight: CGFloat = 220

	var body: some View {
		SidebarSection(title: "Chats") {
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
				ZStack(alignment: .trailing) {
					ScrollView(.vertical, showsIndicators: false) {
						VStack(alignment: .leading, spacing: 2) {
							ForEach(sessions) { session in
								Button {
									onSelectSession(session.id)
								} label: {
									SidebarSessionRow(
										title: session.name,
										subtitle: sidebarSessionDate(session),
										isSelected: session.id == selectedSessionId,
									)
								}
								.buttonStyle(.plain)
								.frame(maxWidth: .infinity, alignment: .leading)
								.disabled(isLoading)
								.accessibilityIdentifier("session-\(session.id)")
								.contextMenu {
									Button(role: .destructive) {
										onDeleteSession(session)
									} label: {
										Label("Delete Session", systemImage: "trash")
									}
									.disabled(isLoading)
								}
							}
							ScrollStateTracker(
								isScrolling: $isWorkspaceScrolling,
								progress: $workspaceScrollProgress
							)
							.frame(width: 0, height: 0)
						}
					}

					if isWorkspaceScrolling {
						Rectangle()
							.fill(AppTheme.tertiaryText.opacity(0.6))
							.frame(width: 3, height: 40)
							.cornerRadius(1.5)
							.padding(.trailing, 2)
							.offset(y: (workspaceScrollProgress - 0.5) * (chatsHeight - 40))
							.transition(.opacity)
							.allowsHitTesting(false)
					}
				}
				.frame(maxHeight: .infinity)
				.background(
					GeometryReader { proxy in
						Color.clear
							.onAppear { chatsHeight = proxy.size.height }
							.onChange(of: proxy.size.height) { _, newValue in
								chatsHeight = newValue
							}
					}
				)
				.animation(.easeInOut(duration: 0.25), value: isWorkspaceScrolling)
			}
		}
	}
}

private struct SidebarHeader: View {
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let updateStore: UpdateStore?
	let onOpenChangelog: () -> Void

	private var appIcon: Image {
		if let nsImage = NSImage(named: NSImage.applicationIconName) {
			return Image(nsImage: nsImage)
		}
		return Image(systemName: "app.fill")
	}

	var body: some View {
		HStack(spacing: 10) {
			Button {
				onOpenChangelog()
			} label: {
				HStack(spacing: 6) {
					appIcon
						.resizable()
						.aspectRatio(contentMode: .fit)
						.frame(width: 22, height: 22)
					Text("Toby")
						.font(.headline)
						.foregroundStyle(AppTheme.primaryText)
					if let version = status?.version {
						Text("v\(version)")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
					}
					if updateStore?.isUpgrading == true {
						Text("Updating")
							.font(.caption2.weight(.medium))
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(.horizontal, 6)
							.padding(.vertical, 3)
							.background(
								Capsule()
									.fill(AppTheme.tertiaryText.opacity(0.12))
							)
							.overlay(
								Capsule()
									.stroke(AppTheme.tertiaryText.opacity(0.3), lineWidth: 1)
							)
							.accessibilityLabel("Updating Toby")
					} else if updateStore?.isUpdateAvailable == true, let latest = updateStore?.latestVersion {
						Text("Update")
							.font(.caption2.weight(.medium))
							.foregroundStyle(AppTheme.accent)
							.padding(.horizontal, 6)
							.padding(.vertical, 3)
							.background(
								Capsule()
									.fill(AppTheme.accent.opacity(0.18))
							)
							.overlay(
								Capsule()
									.stroke(AppTheme.accent.opacity(0.4), lineWidth: 1)
							)
							.accessibilityLabel("Update available, version \(latest)")
					}
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityLabel("Toby version \(status?.version ?? "")")
			.accessibilityHint("Open changelog")
			Spacer(minLength: 0)
			ServerStatusButton(status: status, daemonStatus: daemonStatus)
		}
		.padding(.horizontal, 8)
		.padding(.bottom, 14)
	}
}

private enum ServerHealth: String {
	case connected
	case starting
	case offline

	var color: Color {
		switch self {
		case .connected: .green
		case .starting: .yellow
		case .offline: .red
		}
	}

	var label: String {
		switch self {
		case .connected: "Server connected"
		case .starting: "Server starting"
		case .offline: "Server offline"
		}
	}
}

private struct ServerStatusButton: View {
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	@State private var isPresented = false
	@State private var isHovered = false

	private var health: ServerHealth {
		if status != nil { return .connected }
		if daemonStatus?.process != nil { return .starting }
		return .offline
	}

	var body: some View {
		Button {
			isPresented.toggle()
		} label: {
			Circle()
				.fill(health.color)
				.frame(width: 10, height: 10)
				.overlay(
					Circle()
						.stroke(health.color.opacity(isHovered ? 0.35 : 0), lineWidth: 4)
						.scaleEffect(isHovered ? 1.8 : 1)
				)
				.padding(8)
				.background(
					Circle()
						.fill(AppTheme.primaryText.opacity(isHovered ? 0.1 : 0))
				)
				.contentShape(Circle())
				.animation(.easeInOut(duration: 0.15), value: isHovered)
		}
		.buttonStyle(.plain)
		.onHover { isHovered = $0 }
		.accessibilityLabel(health.label)
		.accessibilityHint("Show server details")
		.popover(isPresented: $isPresented, arrowEdge: .top) {
			ServerStatusDetails(
				status: status,
				daemonStatus: daemonStatus,
				health: health
			)
			.frame(width: 260)
		}
	}
}

private struct ServerStatusDetails: View {
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let health: ServerHealth

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(spacing: 6) {
				Circle()
					.fill(health.color)
					.frame(width: 8, height: 8)
				Text(health.label)
					.font(.callout.weight(.medium))
					.foregroundStyle(AppTheme.primaryText)
				Spacer()
			}
			Text(uptimeText)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
			if let execPath = daemonStatus?.process?.executablePath, !execPath.isEmpty {
				RevealPathButton(path: execPath, label: "Server")
			}
			Divider()
				.background(AppTheme.separator)
			SlackStatusRow(status: status, daemonStatus: daemonStatus)
			ActiveChatRow(daemonStatus: daemonStatus)
		}
		.padding(12)
	}

	private var uptimeText: String {
		guard let seconds = daemonStatus?.process?.uptimeSeconds, seconds > 0 else {
			return "Just started"
		}
		let minutes = seconds / 60
		let hours = minutes / 60
		let remainingMinutes = minutes % 60
		if hours > 0 {
			return "Online for \(hours)h \(remainingMinutes)m"
		}
		return "Online for \(minutes)m"
	}
}

private struct SlackStatusRow: View {
	let status: AppStatus?
	let daemonStatus: DaemonStatus?

	var body: some View {
		HStack(spacing: 8) {
			Text("Slack")
				.font(.caption)
				.foregroundStyle(AppTheme.primaryText)
			Spacer()
			if isConnected {
				HStack(spacing: 4) {
					Circle()
						.fill(Color.green)
						.frame(width: 6, height: 6)
					Text("Connected")
						.font(.caption)
						.foregroundStyle(AppTheme.secondaryText)
				}
				.padding(.horizontal, 6)
				.padding(.vertical, 2)
				.background(
					Capsule()
						.fill(Color.green.opacity(0.15))
				)
				.overlay(
					Capsule()
						.stroke(Color.green.opacity(0.35), lineWidth: 1)
				)
			} else {
				Text("Not connected")
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
	}

	private var isConnected: Bool {
		guard let status else { return false }
		return status.connectedIntegrations?.contains(where: { $0.lowercased() == "slack" }) == true
	}
}

private struct ActiveChatRow: View {
	let daemonStatus: DaemonStatus?

	var body: some View {
		HStack(spacing: 8) {
			if let name = activeConversationName {
				Text("\(name) is chatting now")
					.font(.caption)
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				Spacer()
				ActivePulseIcon()
			} else {
				Text("No active Slack chat")
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
				Spacer()
			}
		}
	}

	private var activeConversationName: String? {
		guard let inbound = daemonStatus?.chatInbound,
			inbound.integration?.lowercased() == "slack",
			inbound.isActive
		else {
			return nil
		}
		return inbound.activeConversationName
	}
}

private struct ActivePulseIcon: View {
	@State private var pulse = false

	var body: some View {
		ZStack {
			Circle()
				.fill(Color.green.opacity(pulse ? 0.25 : 0.0))
				.frame(width: pulse ? 10 : 6, height: pulse ? 10 : 6)
			Circle()
				.fill(Color.green)
				.frame(width: 6, height: 6)
		}
		.frame(width: 10, height: 10)
		.onAppear {
			withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
				pulse = true
			}
		}
		.onDisappear {
			pulse = false
		}
	}
}

private struct CollapsiblePluginsList: View {
	let plugins: [String]
	@State private var isExpanded = false

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Button {
				withAnimation(.easeInOut(duration: 0.2)) {
					isExpanded.toggle()
				}
			} label: {
				HStack(spacing: 8) {
					Text("Plugins")
						.font(.caption)
						.foregroundStyle(AppTheme.secondaryText)
					Spacer()
					Text("\(plugins.count)")
						.font(.caption)
						.foregroundStyle(AppTheme.primaryText)
					Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
						.accessibilityLabel(isExpanded ? "Collapse" : "Expand")
						.font(.caption2)
						.foregroundStyle(AppTheme.tertiaryText)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityLabel("Plugins, \(plugins.count) available")
			if isExpanded {
				VStack(alignment: .leading, spacing: 4) {
					ForEach(plugins, id: \.self) { plugin in
						Text(plugin)
							.font(.caption)
							.foregroundStyle(AppTheme.primaryText)
							.lineLimit(1)
					}
				}
				.padding(.leading, 8)
				.padding(.top, 2)
			}
		}
	}
}

private struct CollapsibleSkillsList: View {
	let skills: [SkillSummary]
	@State private var isExpanded = false

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Button {
				withAnimation(.easeInOut(duration: 0.2)) {
					isExpanded.toggle()
				}
			} label: {
				HStack(spacing: 8) {
					Text("Skills")
						.font(.caption)
						.foregroundStyle(AppTheme.secondaryText)
					Spacer()
					Text("\(skills.count)")
						.font(.caption)
						.foregroundStyle(AppTheme.primaryText)
					Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
						.accessibilityLabel(isExpanded ? "Collapse" : "Expand")
						.font(.caption2)
						.foregroundStyle(AppTheme.tertiaryText)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityLabel("Skills, \(skills.count) available")
			if isExpanded {
				VStack(alignment: .leading, spacing: 4) {
					ForEach(skills) { skill in
						Text(skill.name)
							.font(.caption)
							.foregroundStyle(AppTheme.primaryText)
							.lineLimit(1)
							.help(skill.description ?? "")
					}
				}
				.padding(.leading, 8)
				.padding(.top, 2)
			}
		}
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

private struct SidebarSessionRow: View {
	let title: String
	let subtitle: String?
	var isSelected = false

	var body: some View {
		HStack(spacing: 8) {
			Image(systemName: "message")
				.font(.callout)
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
			VStack(alignment: .leading, spacing: 1) {
				Text(title)
					.font(.callout)
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				if let subtitle {
					Text(subtitle)
						.font(.caption2)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}
			Spacer(minLength: 0)
		}
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

private func sidebarSessionDate(_ session: SessionSummary) -> String? {
	let raw = session.updatedAt ?? session.createdAt
	guard let raw, !raw.isEmpty else { return nil }
	let fractional = ISO8601DateFormatter()
	fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
	let date = fractional.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
	guard let date else { return nil }
	return SidebarDateFormatter.friendly.string(from: date)
}

private enum SidebarDateFormatter {
	static let friendly: DateFormatter = {
		let formatter = DateFormatter()
		formatter.dateStyle = .medium
		formatter.timeStyle = .short
		return formatter
	}()
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
	let onCreatePersona: () -> Void
	let onEditPersona: (String) -> Void
	let onPersonaSelected: () -> Void

	@State private var isPersonaPickerPresented = false

	var body: some View {
		Button {
			isPersonaPickerPresented = true
		} label: {
			HStack(alignment: .center, spacing: 8) {
				if let imageUrlString = status?.personaImageUrl,
					let imageUrl = URL(string: ConfigReader.baseURL().absoluteString + imageUrlString)
				{
					PersonaImageView(url: imageUrl, size: 32)
				} else {
					PersonaImageView(url: ConfigReader.baseURL().appendingPathComponent("api/personas/image/default.png"), size: 32)
				}
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
					.accessibilityLabel("Switch persona")
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
				onCreatePersona: {
					isPersonaPickerPresented = false
					onCreatePersona()
				},
				onEditPersona: { name in
					isPersonaPickerPresented = false
					onEditPersona(name)
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

private struct PersonaPickerRow: View {
	let persona: PersonaOption
	let isCurrent: Bool
	let isSaving: Bool
	let isHovered: Bool
	let onHoverChange: (Bool) -> Void
	let onSelect: () -> Void
	let onEdit: () -> Void

	var body: some View {
		HStack(spacing: 4) {
			Button {
				onSelect()
			} label: {
				HStack(spacing: 8) {
					if let imageUrlString = persona.imageUrl,
						let imageUrl = URL(string: ConfigReader.baseURL().absoluteString + imageUrlString)
					{
						PersonaImageView(url: imageUrl, size: 22)
					} else {
						PersonaImageView(url: ConfigReader.baseURL().appendingPathComponent("api/personas/image/default.png"), size: 22)
					}
					Text(persona.label)
						.lineLimit(1)
					Spacer(minLength: 0)
					if isCurrent {
						Image(systemName: "checkmark")
							.accessibilityLabel("Selected")
							.foregroundStyle(AppTheme.accent)
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.disabled(isSaving)

			if persona.isBuiltIn != true {
				Button {
					onEdit()
				} label: {
					Image(systemName: "pencil")
						.font(.caption.weight(.semibold))
						.foregroundStyle(isHovered ? AppTheme.primaryText : AppTheme.tertiaryText)
						.frame(width: 22, height: 22)
						.background(
							RoundedRectangle(cornerRadius: 5)
								.fill(isHovered ? AppTheme.selection : Color.clear)
						)
						.overlay {
							RoundedRectangle(cornerRadius: 5)
								.stroke(isHovered ? SettingsDesign.controlBorder : Color.clear, lineWidth: 1)
						}
				}
				.buttonStyle(.plain)
				.accessibilityLabel("Edit \(persona.label)")
				.disabled(isSaving)
				.opacity(isHovered ? 1 : 0)
				.animation(.easeInOut(duration: 0.15), value: isHovered)
			}
		}
		.padding(.horizontal, 6)
		.padding(.vertical, 5)
		.onHover { onHoverChange($0) }
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
