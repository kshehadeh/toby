import SwiftUI

/// Shared inputs for the navigation-area toolbar (record / search / settings / back / forward).
@MainActor
struct RootCommonToolbarModel {
	var isRecordingActive: Bool
	var isRecordingProcessing: Bool = false
	var isRecordButtonDisabled: Bool
	var canGoBack: Bool
	var canGoForward: Bool
	var isUpdateAvailable: Bool = false
	var isUpgrading: Bool = false
	var latestVersion: String? = nil
	var onToggleRecording: () -> Void
	var onSearch: () -> Void
	var onOpenSettings: () -> Void
	var onBack: () -> Void
	var onForward: () -> Void
	var onCheckForUpdates: () -> Void = {}
}

/// Route title used for `navigationTitle` / tests. Optional `leading` is the only
/// part that still becomes a toolbar item (integration / project-chat icons).
struct RootHeaderTitle: View {
	let title: String
	var activityLine: String = ""
	var leading: AnyView? = nil

	init(
		title: String,
		activityLine: String = "",
		leading: AnyView? = nil,
		systemImage: String? = nil,
	) {
		self.title = title
		self.activityLine = activityLine
		if let leading {
			self.leading = leading
		} else if let systemImage {
			self.leading = AnyView(
				Image(systemName: systemImage)
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(AppTheme.accent)
					.frame(width: 18, height: 18)
					.accessibilityHidden(true)
			)
		} else {
			self.leading = nil
		}
	}

	/// Integration / external-session icon leading the chat header.
	init(title: String, activityLine: String, integrationIconUrl: URL?) {
		self.title = title
		self.activityLine = activityLine
		if let integrationIconUrl {
			self.leading = AnyView(
				AsyncImage(url: integrationIconUrl) { phase in
					switch phase {
					case .success(let image):
						image
							.resizable()
							.scaledToFit()
					case .failure:
						Image(systemName: "arrowshape.turn.up.left")
							.font(.system(size: 13, weight: .semibold))
							.foregroundStyle(AppTheme.primaryText)
					case .empty:
						Image(systemName: "arrowshape.turn.up.left")
							.font(.system(size: 13, weight: .semibold))
							.foregroundStyle(AppTheme.tertiaryText)
					@unknown default:
						Image(systemName: "arrowshape.turn.up.left")
							.font(.system(size: 13, weight: .semibold))
							.foregroundStyle(AppTheme.tertiaryText)
					}
				}
				.frame(width: 18, height: 18)
			)
		} else {
			self.leading = nil
		}
	}

	var body: some View {
		HStack(spacing: 8) {
			if let leading {
				leading
					.accessibilityHidden(true)
			}
			Text(title)
				.font(.system(size: 17, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(1)
				.truncationMode(.tail)
				.layoutPriority(1)
				.frame(maxWidth: 360, alignment: .leading)
				.accessibilityIdentifier("main-header-title")
			if !activityLine.isEmpty {
				Text(activityLine)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
					.layoutPriority(-1)
			}
		}
		.fixedSize(horizontal: true, vertical: false)
		.help(title)
		.accessibilityElement(children: .combine)
	}
}

/// Main-window toolbar builders for the shell `NavigationSplitView` detail column.
@MainActor
enum RootToolbars {
	/// Back/Forward sit with the sidebar toggle. The route title is the system
	/// `navigationTitle` (not a toolbar item) so `.primaryAction` can stay
	/// trailing.
	@ToolbarContentBuilder
	static func common(_ model: RootCommonToolbarModel, header title: RootHeaderTitle) -> some ToolbarContent {
		ToolbarItemGroup(placement: .navigation) {
			Button(action: model.onBack) {
				Image(systemName: "chevron.backward")
			}
			.disabled(!model.canGoBack)
			.help("Back")
			.accessibilityLabel("Back")
			.accessibilityIdentifier("nav-back-button")
			Button(action: model.onForward) {
				Image(systemName: "chevron.forward")
			}
			.disabled(!model.canGoForward)
			.help("Forward")
			.accessibilityLabel("Forward")
			.accessibilityIdentifier("nav-forward-button")
		}
		if let leading = title.leading {
			ToolbarItem(placement: .navigation) {
				leading
			}
			.sharedBackgroundVisibility(.hidden)
		}
		ToolbarItemGroup(placement: .primaryAction) {
			RecordingToolbarButton(
				isRecordingActive: model.isRecordingActive,
				isRecordingProcessing: model.isRecordingProcessing,
				isRecordButtonDisabled: model.isRecordButtonDisabled,
				onToggleRecording: model.onToggleRecording,
			)
			SettingsToolbarButton(onOpenSettings: model.onOpenSettings)
			SearchToolbarButton(onSearch: model.onSearch)
			if model.isUpdateAvailable || model.isUpgrading {
				Button(action: model.onCheckForUpdates) {
					Image(systemName: model.isUpgrading ? "arrow.down.circle" : "arrow.down.circle.badge.clock")
				}
				.disabled(model.isUpgrading)
				.help(updateHelp(model: model))
				.accessibilityLabel(updateHelp(model: model))
				.accessibilityIdentifier("toolbar-update-button")
			}
		}
	}

	/// Contextual actions must not be sibling `Button`s in `.primaryAction` or
	/// `.automatic` — those placements coalesce with Record/Settings/Search into
	/// one bezel. A `Menu` (Chats) stays separate; icon buttons (Home, etc.) do
	/// not. One `ControlGroup` item in `.confirmationAction` is its own cluster.
	@ToolbarContentBuilder
	static func contextualActions<Content: View>(
		isVisible: Bool = true,
		@ViewBuilder content: () -> Content
	) -> some ToolbarContent {
		if isVisible {
			ToolbarSpacer(.fixed, placement: .confirmationAction)
			ToolbarItem(placement: .confirmationAction) {
				ControlGroup {
					content()
				}
			}
		}
	}

	static func routeTitle(
		_ route: DetailRoute,
		selectedItemName: String? = nil,
		selectedCount: Int = 0
	) -> String {
		if route == .recordings, selectedCount > 1 {
			return "\(selectedCount) recordings"
		}
		guard let name = selectedItemName?.trimmingCharacters(in: .whitespacesAndNewlines),
			!name.isEmpty
		else { return route.menuTitle }
		return name
	}

	static func recordingsNavigationTitle(
		recording: ListenRecordingSummary?,
		selectedCount: Int
	) -> String {
		let name = selectedCount == 1 ? recording.map(recordingSidebarTitle) : nil
		return routeTitle(
			.recordings,
			selectedItemName: name,
			selectedCount: selectedCount
		)
	}

	static func recordingsNavigationSubtitle(
		recording: ListenRecordingSummary?,
		selectedCount: Int
	) -> String {
		guard selectedCount == 1, let recording else { return "" }
		return recordingStartedDateText(recording)
	}

	static func schedulesNavigationSubtitle(isEnabled: Bool, nextRunText: String?) -> String {
		if isEnabled, let nextRunText {
			return "Next run \(nextRunText)"
		}
		if isEnabled {
			return "No upcoming run"
		}
		return "Paused"
	}

	static func skillsNavigationSubtitle(
		isEnabled: Bool,
		updatedAt: String?,
		createdAt: String?
	) -> String {
		var parts: [String] = [isEnabled ? "Enabled" : "Disabled"]
		if let edited = friendlyISODate(updatedAt) {
			parts.append("Edited \(edited)")
		} else if let created = friendlyISODate(createdAt) {
			parts.append("Created \(created)")
		}
		return parts.joined(separator: " · ")
	}

	static func flowsNavigationTitle(
		selectedName: String?,
		editor: FlowEditorDraft? = nil
	) -> String {
		if let editor {
			let name = editor.name.trimmingCharacters(in: .whitespacesAndNewlines)
			if !name.isEmpty { return name }
			return editor.isNew ? "New flow" : "Edit flow"
		}
		return routeTitle(.flows, selectedItemName: selectedName)
	}

	static func flowsNavigationSubtitle(
		_ flow: FlowListItem?,
		editor: FlowEditorDraft? = nil
	) -> String {
		if let editor {
			return editor.isNew ? "New flow" : "Edit flow"
		}
		guard let flow else { return "" }
		return flow.id
	}

	static func projectsNavigationSubtitle(
		project: ProjectSummary?,
		isShowingChat: Bool,
		chatActivityLine: String,
		chatCount: Int,
		personaOptions: [PersonaOption]
	) -> String {
		if isShowingChat { return chatActivityLine }
		guard let project else { return "" }
		return projectMetaLine(
			chatCount: chatCount,
			personaName: project.personaName,
			options: personaOptions
		)
	}

	private static func friendlyISODate(_ value: String?) -> String? {
		guard let value, let date = isoRecordingDate(value) else { return nil }
		return RecordingDateFormatters.friendly.string(from: date)
	}

	static func updateHelp(model: RootCommonToolbarModel) -> String {
		if model.isUpgrading { return "Updating Toby" }
		if let latest = model.latestVersion {
			return "Update to v\(latest) is available"
		}
		return "Update available"
	}

	@ToolbarContentBuilder
	static func dashboard(
		common model: RootCommonToolbarModel,
		updatedText: String,
		isRefreshing: Bool,
		isEditing: Bool = false,
		onToggleEdit: @escaping () -> Void = {},
		showActionsToggle: Bool = false,
		actionsVisible: Bool = true,
		onToggleActions: @escaping () -> Void = {},
		onRefresh: @escaping () -> Void,
	) -> some ToolbarContent {
		common(
			model,
			header: RootHeaderTitle(title: "Home", activityLine: updatedText)
		)
		contextualActions {
			Button(action: onToggleEdit) {
				Image(systemName: isEditing ? "checkmark" : "square.and.pencil")
			}
			.help(dashboardEditHelp(isEditing: isEditing))
			.accessibilityLabel(dashboardEditHelp(isEditing: isEditing))
			.accessibilityIdentifier(dashboardEditIdentifier(isEditing: isEditing))
			if showActionsToggle {
				Button(action: onToggleActions) {
					Image(systemName: "sidebar.trailing")
				}
				.help(dashboardActionsHelp(actionsVisible: actionsVisible))
				.accessibilityLabel(dashboardActionsHelp(actionsVisible: actionsVisible))
				.accessibilityIdentifier("dashboard-actions-toggle")
			}
			Button(action: onRefresh) {
				Image(systemName: "arrow.clockwise")
			}
			.help("Refresh")
			.accessibilityLabel("Refresh")
			.disabled(isRefreshing)
			.accessibilityIdentifier("dashboard-refresh-button")
		}
	}

	static func dashboardEditHelp(isEditing: Bool) -> String {
		isEditing ? "Done" : "Edit Home"
	}

	static func dashboardEditIdentifier(isEditing: Bool) -> String {
		isEditing ? "dashboard-done-editing-button" : "dashboard-edit-button"
	}

	static func dashboardActionsHelp(actionsVisible: Bool) -> String {
		actionsVisible ? "Hide Actions" : "Show Actions"
	}

	@ToolbarContentBuilder
	static func chat(
		common model: RootCommonToolbarModel,
		sessionName: String,
		activityLine: String,
		integrationIconUrl: URL?,
		isLoading: Bool,
		personas: [PersonaOption],
		onNewChat: @escaping (PersonaOption?) -> Void,
	) -> some ToolbarContent {
		common(
			model,
			header: RootHeaderTitle(
				title: routeTitle(.chat, selectedItemName: sessionName),
				activityLine: activityLine,
				integrationIconUrl: integrationIconUrl,
			)
		)
		contextualActions {
			NewChatPersonaMenu(
				personas: personas,
				isDisabled: isLoading,
				onSelect: onNewChat,
			)
		}
	}

	enum IntegrationsToolbarMode: Equatable {
		/// Integrations home: no selected integration.
		case none
		/// Selected and not connected (or status unknown).
		case connect
		/// Selected and connected: Disconnect + Re-connect / Re-authorize.
		case connected
	}

	static func integrationsToolbarMode(hasSelection: Bool, isConnected: Bool) -> IntegrationsToolbarMode {
		if !hasSelection { return .none }
		return isConnected ? .connected : .connect
	}

	@ToolbarContentBuilder
	static func integrations(
		common model: RootCommonToolbarModel,
		title: String = "Integrations",
		hasSelection: Bool,
		isConnected: Bool,
		isActionLoading: Bool,
		reconnectionLabel: String,
		onConnect: @escaping () -> Void,
		onDisconnect: @escaping () -> Void,
		onReauthorize: @escaping () -> Void,
	) -> some ToolbarContent {
		common(model, header: RootHeaderTitle(title: title))
		contextualActions(isVisible: hasSelection) {
			switch integrationsToolbarMode(hasSelection: hasSelection, isConnected: isConnected) {
			case .none:
				EmptyView()
			case .connect:
				Button(action: onConnect) {
					Image(systemName: "link")
				}
				.help("Connect")
				.disabled(isActionLoading)
				.accessibilityIdentifier("connect-integration-button")
				.accessibilityLabel("Connect")
			case .connected:
				Button(role: .destructive, action: onDisconnect) {
					Image(systemName: "xmark")
				}
				.help("Disconnect")
				.disabled(isActionLoading)
				.accessibilityIdentifier("disconnect-integration-button")
				.accessibilityLabel("Disconnect")
			}
			if integrationsToolbarMode(hasSelection: hasSelection, isConnected: isConnected) == .connected {
				Button(action: onReauthorize) {
					Image(systemName: "arrow.triangle.2.circlepath")
				}
				.help(reconnectionLabel)
				.disabled(isActionLoading)
				.accessibilityIdentifier("reconnect-integration-button")
				.accessibilityLabel(reconnectionLabel)
			}
		}
	}

	enum ProjectToolbarMode: Equatable {
		/// All-projects / empty state: only New Project.
		case home
		/// Project details: New Chat + Delete.
		case project
		/// Project chat: return to the project page.
		case projectChat
	}

	static func projectToolbarMode(hasSelection: Bool, isShowingChat: Bool) -> ProjectToolbarMode {
		if isShowingChat { return .projectChat }
		if hasSelection { return .project }
		return .home
	}

	@ToolbarContentBuilder
	static func projects(
		common model: RootCommonToolbarModel,
		selectedProjectName: String,
		sessionName: String = "",
		activityLine: String,
		isSaving: Bool,
		isChatLoading: Bool,
		isShowingChat: Bool = false,
		hasSelection: Bool = false,
		onNewProject: @escaping () -> Void,
		onNewChat: @escaping () -> Void = {},
		onDelete: @escaping () -> Void = {},
		onReturnToProject: @escaping () -> Void = {},
		isFilesSidebarPresented: Bool = false,
		onToggleFilesSidebar: @escaping () -> Void = {},
		isChatsSidebarPresented: Bool = false,
		onToggleChatsSidebar: @escaping () -> Void = {},
	) -> some ToolbarContent {
		common(
			model,
			header: RootHeaderTitle(
				title: routeTitle(.projects, selectedItemName: isShowingChat ? sessionName : selectedProjectName),
				activityLine: activityLine,
				systemImage: isShowingChat ? "folder.fill" : nil,
			)
		)
		contextualActions {
			switch projectToolbarMode(hasSelection: hasSelection, isShowingChat: isShowingChat) {
			case .projectChat:
				Button(action: onReturnToProject) {
					Image(systemName: "arrow.uturn.backward")
				}
				.help("Back to \(selectedProjectName)")
				.accessibilityLabel("Back to \(selectedProjectName)")
				.accessibilityIdentifier("project-chat-home-button")
			case .project:
				Button(action: onNewChat) {
					Label("Chat", systemImage: "plus")
				}
				.help("New Chat")
				.disabled(isSaving || isChatLoading)
				.accessibilityIdentifier("toolbar-project-new-chat-button")
				.accessibilityLabel("New Chat")
			case .home:
				Button(action: onNewProject) {
					Image(systemName: "plus")
				}
				.help("New Project")
				.disabled(isSaving || isChatLoading)
				.accessibilityIdentifier("toolbar-new-project-button")
				.accessibilityLabel("New Project")
			}
			switch projectToolbarMode(hasSelection: hasSelection, isShowingChat: isShowingChat) {
			case .projectChat:
				Button(action: onToggleFilesSidebar) {
					Image(systemName: "sidebar.trailing")
				}
				.help(projectFilesHelp(isPresented: isFilesSidebarPresented))
				.accessibilityLabel(projectFilesHelp(isPresented: isFilesSidebarPresented))
				.accessibilityIdentifier("project-files-toggle")
			case .project:
				Button(action: onToggleChatsSidebar) {
					Image(systemName: "sidebar.trailing")
				}
				.help(projectChatsHelp(isPresented: isChatsSidebarPresented))
				.accessibilityLabel(projectChatsHelp(isPresented: isChatsSidebarPresented))
				.accessibilityIdentifier("project-chats-toggle")
			case .home:
				EmptyView()
			}
			if projectToolbarMode(hasSelection: hasSelection, isShowingChat: isShowingChat) == .project {
				Button(role: .destructive, action: onDelete) {
					Image(systemName: "trash")
				}
				.help("Delete Project")
				.disabled(isSaving)
				.accessibilityIdentifier("delete-project-button")
				.accessibilityLabel("Delete Project")
			}
		}
	}

	static func projectFilesHelp(isPresented: Bool) -> String {
		isPresented ? "Hide Files" : "Show Files"
	}

	static func projectChatsHelp(isPresented: Bool) -> String {
		isPresented ? "Hide Chats" : "Show Chats"
	}

	@ToolbarContentBuilder
	static func schedules(
		common model: RootCommonToolbarModel,
		title: String = "Schedules",
		hasSelection: Bool,
		isSaving: Bool,
		isRunning: Bool,
		isDeleting: Bool,
		onNew: @escaping () -> Void,
		onRun: @escaping () -> Void,
		onDelete: @escaping () -> Void,
	) -> some ToolbarContent {
		common(model, header: RootHeaderTitle(title: title))
		contextualActions {
			if !hasSelection {
				Button(action: onNew) {
					Image(systemName: "plus")
				}
				.help("New Schedule")
				.disabled(isSaving)
				.accessibilityIdentifier("toolbar-new-schedule-button")
				.accessibilityLabel("New Schedule")
			} else {
				Button(action: onRun) {
					Image(systemName: "play.fill")
				}
				.help("Run Now")
				.accessibilityLabel("Run Now")
				// Autosave must not disable Run; only block while a run is in flight.
				.disabled(isRunning)
				.accessibilityIdentifier("run-schedule-button")
			}
			if hasSelection {
				Button(role: .destructive, action: onDelete) {
					Image(systemName: "trash")
				}
				.help("Delete Schedule")
				.accessibilityLabel("Delete Schedule")
				.disabled(isDeleting)
				.accessibilityIdentifier("delete-schedule-button")
			}
		}
	}

	enum RecordingsChatToolbarMode: Equatable {
		case hidden
		case startChat
		case showChat
	}

	static func recordingsChatToolbarMode(
		hasSingleSelection: Bool,
		existingChatSessionId: String?,
	) -> RecordingsChatToolbarMode {
		guard hasSingleSelection else { return .hidden }
		return existingChatSessionId != nil ? .showChat : .startChat
	}

	static func recordingsChatHelp(mode: RecordingsChatToolbarMode) -> String {
		switch mode {
		case .hidden: return ""
		case .startChat: return "Start Chat"
		case .showChat: return "Show Chat"
		}
	}

	static func recordingsChatIdentifier(mode: RecordingsChatToolbarMode) -> String {
		switch mode {
		case .hidden: return ""
		case .startChat: return "start-recording-chat-button"
		case .showChat: return "show-recording-chat-button"
		}
	}

	@ToolbarContentBuilder
	static func recordings(
		common model: RootCommonToolbarModel,
		title: String = "Recordings",
		hasSelection: Bool,
		hasSingleSelection: Bool = false,
		existingChatSessionId: String? = nil,
		deleteHelp: String,
		isDeleting: Bool,
		onDelete: @escaping () -> Void,
		onStartChat: @escaping () -> Void = {},
		onShowChat: @escaping () -> Void = {},
	) -> some ToolbarContent {
		common(model, header: RootHeaderTitle(title: title))
		contextualActions(isVisible: hasSelection) {
			let mode = recordingsChatToolbarMode(
				hasSingleSelection: hasSingleSelection,
				existingChatSessionId: existingChatSessionId,
			)
			if mode != .hidden {
				Button {
					if mode == .showChat {
						onShowChat()
					} else {
						onStartChat()
					}
				} label: {
					Image(systemName: "bubble.left.and.bubble.right")
				}
				.help(recordingsChatHelp(mode: mode))
				.accessibilityLabel(recordingsChatHelp(mode: mode))
				.accessibilityIdentifier(recordingsChatIdentifier(mode: mode))
			}
			if hasSelection {
				Button(role: .destructive, action: onDelete) {
					Image(systemName: "trash")
				}
				.help(deleteHelp)
				.accessibilityLabel(deleteHelp)
				.disabled(isDeleting)
				.accessibilityIdentifier("delete-recordings-button")
			}
		}
	}

	@ToolbarContentBuilder
	static func skills(
		common model: RootCommonToolbarModel,
		title: String = "Skills",
		hasSelection: Bool,
		isSaving: Bool,
		onNew: @escaping () -> Void,
		onDelete: @escaping () -> Void,
	) -> some ToolbarContent {
		common(model, header: RootHeaderTitle(title: title))
		contextualActions {
			if !hasSelection {
				Button(action: onNew) {
					Image(systemName: "plus")
				}
				.help("New Skill")
				.disabled(isSaving)
				.accessibilityIdentifier("toolbar-new-skill-button")
				.accessibilityLabel("New Skill")
			} else {
				Button(role: .destructive, action: onDelete) {
					Image(systemName: "trash")
				}
				.help("Delete Skill")
				.accessibilityLabel("Delete Skill")
				.disabled(isSaving)
				.accessibilityIdentifier("delete-skill-button")
			}
		}
	}

	enum FlowsToolbarMode: Equatable {
		/// Card / home list: New + Refresh.
		case home
		/// Selected flow detail: Edit / Run / Delete for custom flows.
		case detail
		/// Create / edit sheet content: no list or detail actions.
		case editor
	}

	static func flowsToolbarMode(hasSelection: Bool, isEditing: Bool) -> FlowsToolbarMode {
		if isEditing { return .editor }
		if hasSelection { return .detail }
		return .home
	}

	@ToolbarContentBuilder
	static func flows(
		common model: RootCommonToolbarModel,
		title: String = "Flows",
		isListLoading: Bool,
		isRunsLoading: Bool,
		hasSelection: Bool,
		isEditing: Bool,
		canEdit: Bool,
		canRun: Bool,
		canDelete: Bool,
		isRunning: Bool,
		onNewFlow: @escaping () -> Void,
		onRefresh: @escaping () -> Void,
		onEdit: @escaping () -> Void,
		onRun: @escaping () -> Void,
		onDelete: @escaping () -> Void,
		isSaving: Bool = false,
		canSave: Bool = false,
		onCancel: @escaping () -> Void = {},
		onSave: @escaping () -> Void = {},
	) -> some ToolbarContent {
		let mode = flowsToolbarMode(hasSelection: hasSelection, isEditing: isEditing)
		common(model, header: RootHeaderTitle(title: title))
		contextualActions(
			isVisible: mode == .home
				|| mode == .editor
				|| (mode == .detail && (canEdit || canRun || canDelete))
		) {
			switch mode {
			case .home:
				Button(action: onNewFlow) {
					Image(systemName: "plus")
				}
				.help("New flow")
				.accessibilityIdentifier("toolbar-new-flow-button")
				.accessibilityLabel("New flow")
			case .detail:
				if canEdit {
					Button(action: onEdit) {
						Image(systemName: "pencil")
					}
					.help("Edit Flow")
					.accessibilityIdentifier("edit-flow-button")
					.accessibilityLabel("Edit Flow")
				}
			case .editor:
				Button(action: onCancel) {
					Image(systemName: "xmark")
				}
				.help("Cancel")
				.disabled(isSaving)
				.keyboardShortcut(.cancelAction)
				.accessibilityIdentifier("flow-editor-cancel")
				.accessibilityLabel("Cancel")
			}
			switch mode {
			case .home:
				Button(action: onRefresh) {
					Image(systemName: "arrow.clockwise")
				}
				.help("Refresh flows")
				.disabled(isListLoading || isRunsLoading)
				.accessibilityIdentifier("refresh-flows-button")
				.accessibilityLabel("Refresh flows")
			case .detail:
				if canRun {
					Button(action: onRun) {
						Image(systemName: "play.fill")
					}
					.help("Run Now")
					.disabled(isRunning)
					.keyboardShortcut("r", modifiers: [.command])
					.accessibilityIdentifier("run-flow-button")
					.accessibilityLabel("Run Now")
				}
			case .editor:
				Button(action: onSave) {
					Image(systemName: "checkmark")
				}
				.help("Save")
				.disabled(isSaving || !canSave)
				.keyboardShortcut(.defaultAction)
				.accessibilityIdentifier("flow-editor-save")
				.accessibilityLabel(isSaving ? "Saving" : "Save")
			}
			if mode == .detail, canDelete {
				Button(role: .destructive, action: onDelete) {
					Image(systemName: "trash")
				}
				.help("Delete Flow")
				.accessibilityIdentifier("delete-flow-button")
				.accessibilityLabel("Delete Flow")
			}
		}
	}

	static func recordingsDeleteHelp(selectedCount: Int) -> String {
		if selectedCount == 1 {
			return "Delete Recording"
		}
		return "Delete \(selectedCount) Recordings"
	}

	static func dashboardUpdatedText(lastLoadedAt: Date?) -> String {
		guard let lastLoadedAt else { return "" }
		let formatter = RelativeDateTimeFormatter()
		formatter.unitsStyle = .abbreviated
		return "Updated \(formatter.localizedString(for: lastLoadedAt, relativeTo: Date()))"
	}
}
