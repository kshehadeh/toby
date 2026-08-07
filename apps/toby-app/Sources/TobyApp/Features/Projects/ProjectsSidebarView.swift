import SwiftUI

struct ProjectsSidebarView: View {
	@Bindable var store: ProjectsStore
	let selectedSessionId: String?
	let onCreate: () -> Void
	let onSelect: (String) -> Void
	let onSelectSession: (String) -> Void

	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	/// Single-line title content height. Hard-capped so layout proposals cannot
	/// stretch the project header (macOS was leaving a large empty band under the name).
	private let titleRowHeight: CGFloat = 16

	private var expandAnimation: Animation? {
		reduceMotion ? nil : .easeOut(duration: 0.22)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			HStack {
				Text("Projects")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(AppTheme.secondaryText)
				Spacer()
				Button(action: onCreate) {
					Image(systemName: "plus")
				}
				.buttonStyle(.plain)
				.help("New Project")
				.accessibilityLabel("New Project")
			}
			.padding(.horizontal, 12)
			.padding(.vertical, 8)

			ScrollView {
				LazyVStack(alignment: .leading, spacing: 4) {
					if store.isLoading && store.projects.isEmpty {
						Text("Loading projects…")
							.font(.system(size: 12))
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(12)
					} else if store.projects.isEmpty {
						Text("No projects")
							.font(.system(size: 12))
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(12)
					} else {
						ForEach(store.projects) { project in
							projectRow(project)
						}
					}
				}
				.padding(.horizontal, 8)
				.animation(expandAnimation, value: store.selectedProjectId)
			}
		}
	}

	@ViewBuilder
	private func projectRow(_ project: ProjectSummary) -> some View {
		let isSelectedProject = store.selectedProjectId == project.id

		VStack(alignment: .leading, spacing: 2) {
			// Flat header (not a Button — control sizing was stretching the row).
			HStack(alignment: .center, spacing: 8) {
				Image(systemName: isSelectedProject ? "folder.fill" : "folder")
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(AppTheme.accent)
					.frame(width: titleRowHeight, height: titleRowHeight)
					.contentTransition(.symbolEffect(.replace))

				Text(project.name)
					.font(.system(size: 13, weight: isSelectedProject ? .semibold : .medium))
					.lineLimit(1)
					.frame(height: titleRowHeight, alignment: .leading)

				Spacer(minLength: 0)
			}
			.frame(height: titleRowHeight)
			.padding(.horizontal, 10)
			.padding(.top, 4)
			.padding(.bottom, 2)
			// Total header height is fixed: 16 + 4 + 2 = 22.
			.frame(height: titleRowHeight + 6)
			.frame(maxWidth: .infinity, alignment: .leading)
			.overlay(alignment: .bottom) {
				if isSelectedProject {
					Rectangle()
						.fill(AppTheme.accent)
						.frame(height: 1)
						.padding(.horizontal, 10)
						.transition(.opacity)
				}
			}
			.contentShape(Rectangle())
			.onTapGesture { onSelect(project.id) }
			.accessibilityElement(children: .combine)
			.accessibilityLabel(project.name)
			.accessibilityAddTraits(isSelectedProject ? [.isButton, .isSelected] : .isButton)

			if isSelectedProject {
				projectSessionsList(for: project.id)
					.transition(
						reduceMotion
							? .opacity
							: .opacity.combined(with: .move(edge: .top))
					)
			}
		}
		.fixedSize(horizontal: false, vertical: true)
		.frame(maxWidth: .infinity, alignment: .topLeading)
		.clipped()
	}

	@ViewBuilder
	private func projectSessionsList(for projectId: String) -> some View {
		let sessions = store.sessions(for: projectId)
		if sessions.isEmpty {
			Text("No chats")
				.font(.system(size: 11))
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.leading, 32)
				.padding(.vertical, 3)
		} else {
			ForEach(sessions) { session in
				let isActive = session.id == selectedSessionId
				Button {
					onSelectSession(session.id)
				} label: {
					HStack(spacing: 6) {
						Image(systemName: isActive ? "bubble.left.fill" : "bubble.left")
							.foregroundStyle(isActive ? AppTheme.primaryText : AppTheme.secondaryText)
							.frame(width: 14)
						Text(session.name)
							.font(.system(size: 12))
							.foregroundStyle(isActive ? AppTheme.primaryText : AppTheme.secondaryText)
							.lineLimit(1)
						Spacer(minLength: 0)
						if isActive {
							Circle()
								.fill(Color.green)
								.frame(width: 7, height: 7)
						}
					}
					.padding(.leading, 30)
					.padding(.trailing, 8)
					.padding(.vertical, 4)
					.background(
						RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
							.fill(isActive ? AppTheme.selection.opacity(0.75) : Color.clear)
					)
				}
				.buttonStyle(.plain)
			}
		}
	}
}
