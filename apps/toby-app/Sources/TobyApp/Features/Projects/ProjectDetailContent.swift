import SwiftUI

enum ProjectDetailTab: String, Hashable, CaseIterable {
	case details
	case chats
}

struct ProjectDetailContent: View {
	@Bindable var store: ProjectsStore
	let project: ProjectSummary
	var onSelectChat: ((String) -> Void)?

	var body: some View {
		TabView(selection: $store.selectedDetailTab) {
			Tab(value: ProjectDetailTab.details) {
				ProjectDetailsPane(store: store, project: project)
			} label: {
				Text("Details")
			}
			Tab(value: ProjectDetailTab.chats) {
				ProjectChatsPane(store: store, onSelectChat: onSelectChat ?? { _ in })
			} label: {
				Text("Chats")
			}
		}
		.padding(AppTheme.contentPadding)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("project-detail-tabs")
	}
}

struct ProjectDetailsPane: View {
	@Bindable var store: ProjectsStore
	let project: ProjectSummary

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 22) {
				DetailHeading(
					title: store.selectedProject?.name ?? project.name,
					accessibilityIdentifier: "project-detail-name"
				)

				VStack(alignment: .leading, spacing: 12) {
					DetailMetadataRow(
						label: "Persona",
						value: projectPersonaLabel(
							personaName: store.selectedProject?.personaName ?? project.personaName,
							options: store.personaOptions
						)
					)
				}

				summarySection
				pathSection
				ProjectFileTreeSection(store: store)
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth + 80)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("project-details-tab")
	}

	private var summarySection: some View {
		let summary = store.selectedProject?.summary ?? project.summary
		let trimmed = summary.trimmingCharacters(in: .whitespacesAndNewlines)

		return DetailSection(title: "Summary") {
			if trimmed.isEmpty {
				Text("No summary yet")
					.font(.system(size: 13))
					.foregroundStyle(AppTheme.tertiaryText)
					.frame(maxWidth: .infinity, alignment: .leading)
					.accessibilityIdentifier("project-summary-empty-placeholder")
			} else {
				MarkdownText(
					text: summary,
					font: .system(size: 13),
					foregroundStyle: SettingsDesign.rowTitle
				)
				.textSelection(.enabled)
				.frame(maxWidth: .infinity, alignment: .leading)
				.accessibilityIdentifier("project-summary-preview")
			}
		}
	}

	private var pathSection: some View {
		DetailSection(title: "Folder") {
			RevealPathButton(path: store.selectedProject?.folderPath ?? project.folderPath)
		}
	}
}

struct ProjectChatsPane: View {
	@Bindable var store: ProjectsStore
	let onSelectChat: (String) -> Void

	var body: some View {
		Group {
			if store.selectedProjectSessions.isEmpty {
				ContentUnavailableView {
					Label {
						Text("No chats yet")
					} icon: {
						Image(systemName: "bubble.left")
							.accessibilityHidden(true)
					}
				} description: {
					Text("Use + Chat in the toolbar to start one.")
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.accessibilityIdentifier("project-chats-tab-empty")
			} else {
				ScrollView {
					VStack(alignment: .leading, spacing: 2) {
						ForEach(store.selectedProjectSessions) { session in
							Button {
								onSelectChat(session.id)
							} label: {
								ProjectChatsRow(session: session)
							}
							.buttonStyle(.plain)
							.accessibilityIdentifier("project-chats-tab-row-\(session.id)")
						}
					}
					.frame(maxWidth: .infinity, alignment: .topLeading)
				}
				.automaticScrollIndicators(axes: .vertical)
			}
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("project-chats-tab")
	}
}

private struct ProjectChatsRow: View {
	let session: SessionSummary

	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			Image(systemName: session.isExternal ? "bubble.left.and.bubble.right" : "bubble.left")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 16, height: 16)
				.padding(.top, 2)
			VStack(alignment: .leading, spacing: 2) {
				Text(session.name)
					.font(.system(size: 12, weight: .medium))
					.foregroundStyle(AppTheme.secondaryText)
					.lineLimit(1)
				if let date = sidebarSessionDate(session) {
					Text(date)
						.font(.system(size: 10))
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}
			Spacer(minLength: 0)
			Image(systemName: "chevron.right")
				.font(.system(size: 10, weight: .semibold))
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.top, 2)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 4)
		.contentShape(Rectangle())
	}
}
