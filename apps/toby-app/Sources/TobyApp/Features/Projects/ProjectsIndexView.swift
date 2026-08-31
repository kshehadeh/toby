import SwiftUI

struct ProjectsIndexView: View {
	@Bindable var store: ProjectsStore
	let onSelect: (String) -> Void

	private let columns = [
		GridItem(.adaptive(minimum: 240, maximum: 360), spacing: 16),
	]

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				header
				LazyVGrid(columns: columns, spacing: 16) {
					ForEach(store.projects) { project in
						Button {
							onSelect(project.id)
						} label: {
							ProjectCard(
								project: project,
								metaLine: store.metaLine(for: project),
							)
						}
						.buttonStyle(.plain)
						.accessibilityIdentifier("project-card-\(project.id)")
					}
				}
			}
			.padding(24)
			.frame(maxWidth: 980)
			.frame(maxWidth: .infinity)
		}
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("projects-home-view")
	}

	private var header: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Projects")
				.font(.system(size: 24, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("Workspaces with their own chats, instructions, skills, and generated files. Select a project to open it.")
				.font(.body)
				.foregroundStyle(SettingsDesign.rowDescription)
				.fixedSize(horizontal: false, vertical: true)
		}
	}
}

struct ProjectsEmptyStateView: View {
	let isBusy: Bool
	let onCreate: () -> Void

	var body: some View {
		VStack(spacing: 18) {
			Image(systemName: "folder")
				.font(.system(size: 72, weight: .regular))
				.foregroundStyle(SettingsDesign.rowDescription)
				.accessibilityHidden(true)

			VStack(spacing: 8) {
				Text("Projects")
					.font(.system(size: 28, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)

				Text("Projects keep chats, instructions, and generated files together for a body of work. Create one to start a scoped workspace.")
					.font(.body)
					.foregroundStyle(SettingsDesign.rowDescription)
					.multilineTextAlignment(.center)
					.lineLimit(4)
					.frame(maxWidth: 480)
			}

			Button(action: onCreate) {
				Label("Create Project", systemImage: "plus")
			}
			.buttonStyle(.borderedProminent)
			.disabled(isBusy)
			.accessibilityIdentifier("empty-create-project-button")
		}
		.padding(32)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier("projects-empty-state")
	}
}

struct ProjectCard: View {
	let project: ProjectSummary
	let metaLine: String

	private var summaryPreview: String {
		projectSummaryFirstParagraph(project.summary)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			HStack(alignment: .top, spacing: 12) {
				RoundedRectangle(cornerRadius: 10)
					.fill(AppTheme.accent.opacity(0.16))
					.frame(width: 40, height: 40)
					.overlay {
						Image(systemName: "folder.fill")
							.font(.system(size: 17, weight: .semibold))
							.foregroundStyle(AppTheme.accent)
					}
				VStack(alignment: .leading, spacing: 4) {
					Text(project.name)
						.font(.system(size: 15, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
						.lineLimit(2)
						.multilineTextAlignment(.leading)
					Text(metaLine)
						.font(.system(size: 11, weight: .medium))
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
				Spacer(minLength: 0)
			}

			Text(summaryPreview.isEmpty ? "No summary yet" : summaryPreview)
				.font(.system(size: 12))
				.foregroundStyle(
					summaryPreview.isEmpty
						? AppTheme.tertiaryText
						: SettingsDesign.rowDescription
				)
				.lineLimit(3)
				.multilineTextAlignment(.leading)
				.frame(maxWidth: .infinity, alignment: .leading)
				.frame(minHeight: 48, alignment: .topLeading)

			HStack {
				Spacer()
				Image(systemName: "chevron.right")
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
		.padding(16)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		)
	}
}
