import SwiftUI

/// Shared inputs for the navigation-area toolbar (record / search / settings / back / forward).
@MainActor
struct RootCommonToolbarModel {
	var isRecordingActive: Bool
	var isRecordButtonDisabled: Bool
	var canGoBack: Bool
	var canGoForward: Bool
	var onToggleRecording: () -> Void
	var onSearch: () -> Void
	var onOpenSettings: () -> Void
	var onBack: () -> Void
	var onForward: () -> Void
}

/// Capsule chrome used for principal session / route titles in the main window toolbar.
struct RootPrincipalTitle: View {
	let title: String
	var activityLine: String = ""
	var leading: AnyView? = nil

	init(title: String, activityLine: String = "", leading: AnyView? = nil) {
		self.title = title
		self.activityLine = activityLine
		self.leading = leading
	}

	/// Integration / external-session icon leading the chat principal title.
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
			}
			SessionTitleBadge(
				title: title,
				activityLine: activityLine,
			)
		}
		.padding(.horizontal, 14)
		.padding(.vertical, 8)
		.background(
			Capsule()
				.fill(AppTheme.elevatedBackground.opacity(0.92)),
		)
		.overlay(
			Capsule()
				.stroke(Color.white.opacity(0.12), lineWidth: 1),
		)
		.fixedSize(horizontal: true, vertical: false)
	}
}

/// Main-window toolbar builders for the shell `NavigationSplitView` detail column.
@MainActor
enum RootToolbars {
	@ToolbarContentBuilder
	static func common(_ model: RootCommonToolbarModel) -> some ToolbarContent {
		ToolbarItem(placement: .navigation) {
			RecordingToolbarButton(
				isRecordingActive: model.isRecordingActive,
				isRecordButtonDisabled: model.isRecordButtonDisabled,
				onToggleRecording: model.onToggleRecording,
			)
		}
		ToolbarItem(placement: .navigation) {
			SearchToolbarButton(onSearch: model.onSearch)
		}
		ToolbarItem(placement: .navigation) {
			SettingsToolbarButton(onOpenSettings: model.onOpenSettings)
		}
		ToolbarItem(placement: .navigation) {
			Button(action: model.onBack) {
				Image(systemName: "chevron.backward")
			}
			.disabled(!model.canGoBack)
			.help("Back")
			.accessibilityIdentifier("nav-back-button")
		}
		ToolbarItem(placement: .navigation) {
			Button(action: model.onForward) {
				Image(systemName: "chevron.forward")
			}
			.disabled(!model.canGoForward)
			.help("Forward")
			.accessibilityIdentifier("nav-forward-button")
		}
	}

	@ToolbarContentBuilder
	static func dashboard(
		common model: RootCommonToolbarModel,
		updatedText: String,
		isRefreshing: Bool,
		onRefresh: @escaping () -> Void,
	) -> some ToolbarContent {
		common(model)
		ToolbarItem(placement: .principal) {
			RootPrincipalTitle(title: "Dashboard", activityLine: updatedText)
		}
		ToolbarItem(placement: .confirmationAction) {
			Button(action: onRefresh) {
				Image(systemName: "arrow.clockwise")
			}
			.help("Refresh")
			.disabled(isRefreshing)
			.accessibilityIdentifier("dashboard-refresh-button")
		}
	}

	@ToolbarContentBuilder
	static func chat(
		common model: RootCommonToolbarModel,
		sessionName: String,
		activityLine: String,
		integrationIconUrl: URL?,
		isLoading: Bool,
		onNewChat: @escaping () -> Void,
	) -> some ToolbarContent {
		common(model)
		ToolbarItem(placement: .principal) {
			RootPrincipalTitle(
				title: sessionName,
				activityLine: activityLine,
				integrationIconUrl: integrationIconUrl,
			)
		}
		ToolbarItem(placement: .confirmationAction) {
			Button(action: onNewChat) {
				Image(systemName: "plus")
			}
			.help("New Chat")
			.disabled(isLoading)
			.accessibilityIdentifier("new-chat-button")
		}
	}

	@ToolbarContentBuilder
	static func integrations(common model: RootCommonToolbarModel) -> some ToolbarContent {
		common(model)
		ToolbarItem(placement: .principal) { Spacer() }
	}

	@ToolbarContentBuilder
	static func projects(
		common model: RootCommonToolbarModel,
		selectedProjectName: String,
		activityLine: String,
		isSaving: Bool,
		isChatLoading: Bool,
		onNewProject: @escaping () -> Void,
	) -> some ToolbarContent {
		common(model)
		ToolbarItem(placement: .principal) {
			RootPrincipalTitle(title: selectedProjectName, activityLine: activityLine)
		}
		ToolbarItem(placement: .confirmationAction) {
			Button(action: onNewProject) {
				Image(systemName: "plus")
			}
			.help("New Project")
			.disabled(isSaving || isChatLoading)
		}
	}

	@ToolbarContentBuilder
	static func schedules(
		common model: RootCommonToolbarModel,
		hasSelection: Bool,
		isRunning: Bool,
		isDeleting: Bool,
		onRun: @escaping () -> Void,
		onDelete: @escaping () -> Void,
	) -> some ToolbarContent {
		common(model)
		ToolbarItem(placement: .principal) { Spacer() }
		ToolbarItem(placement: .confirmationAction) {
			if hasSelection {
				Button(action: onRun) {
					Image(systemName: "play.fill")
				}
				.help("Run Now")
				// Autosave must not disable Run; only block while a run is in flight.
				.disabled(isRunning)
				.accessibilityIdentifier("run-schedule-button")
			}
		}
		ToolbarItem(placement: .confirmationAction) {
			if hasSelection {
				Button(role: .destructive, action: onDelete) {
					Image(systemName: "trash")
				}
				.help("Delete Schedule")
				.disabled(isDeleting)
				.accessibilityIdentifier("delete-schedule-button")
			}
		}
	}

	@ToolbarContentBuilder
	static func recordings(
		common model: RootCommonToolbarModel,
		hasSelection: Bool,
		deleteHelp: String,
		isDeleting: Bool,
		onDelete: @escaping () -> Void,
	) -> some ToolbarContent {
		common(model)
		ToolbarItem(placement: .principal) { Spacer() }
		ToolbarItem(placement: .confirmationAction) {
			if hasSelection {
				Button(role: .destructive, action: onDelete) {
					Image(systemName: "trash")
				}
				.help(deleteHelp)
				.disabled(isDeleting)
				.accessibilityIdentifier("delete-recordings-button")
			}
		}
	}

	@ToolbarContentBuilder
	static func skills(
		common model: RootCommonToolbarModel,
		hasSelection: Bool,
		isSaving: Bool,
		onDelete: @escaping () -> Void,
	) -> some ToolbarContent {
		common(model)
		ToolbarItem(placement: .principal) { Spacer() }
		ToolbarItem(placement: .confirmationAction) {
			if hasSelection {
				Button(role: .destructive, action: onDelete) {
					Image(systemName: "trash")
				}
				.help("Delete Skill")
				.disabled(isSaving)
				.accessibilityIdentifier("delete-skill-button")
			}
		}
	}

	@ToolbarContentBuilder
	static func memories(
		common model: RootCommonToolbarModel,
		isListLoading: Bool,
		isSaving: Bool,
		onRefresh: @escaping () -> Void,
	) -> some ToolbarContent {
		common(model)
		ToolbarItem(placement: .principal) { Spacer() }
		ToolbarItem(placement: .confirmationAction) {
			Button(action: onRefresh) {
				Image(systemName: "arrow.clockwise")
			}
			.help("Refresh memories")
			.disabled(isListLoading || isSaving)
			.accessibilityIdentifier("refresh-memories-button")
			.accessibilityLabel("Refresh memories")
		}
	}

	@ToolbarContentBuilder
	static func flows(
		common model: RootCommonToolbarModel,
		isListLoading: Bool,
		isRunsLoading: Bool,
		onRefresh: @escaping () -> Void,
	) -> some ToolbarContent {
		common(model)
		ToolbarItem(placement: .principal) { Spacer() }
		ToolbarItem(placement: .confirmationAction) {
			Button(action: onRefresh) {
				Image(systemName: "arrow.clockwise")
			}
			.help("Refresh flows")
			.disabled(isListLoading || isRunsLoading)
			.accessibilityIdentifier("refresh-flows-button")
			.accessibilityLabel("Refresh flows")
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
