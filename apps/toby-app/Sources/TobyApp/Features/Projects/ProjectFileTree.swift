import SwiftUI

struct ProjectFileTreeSection: View {
	@Bindable var store: ProjectsStore
	var changeKinds: [String: ProjectTreeChangeKind] = [:]

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack {
				Text("Files")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Spacer()
				Button {
					Task { await store.refreshTree() }
				} label: {
					Image(systemName: "arrow.clockwise")
				}
				.buttonStyle(.plain)
				.help("Refresh files")
			}
			if store.tree.isEmpty {
				Text("No files")
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.tertiaryText)
			} else {
				VStack(alignment: .leading, spacing: 2) {
					ForEach(store.tree) { entry in
						ProjectTreeRow(
							entry: entry,
							projectFolderPath: store.selectedProject?.folderPath ?? "",
							depth: 0,
							changeKinds: changeKinds
						)
					}
				}
			}
		}
	}
}

struct ProjectTreeRow: View {
	let entry: ProjectTreeEntry
	let projectFolderPath: String
	let depth: Int
	var changeKinds: [String: ProjectTreeChangeKind] = [:]
	@State private var isExpanded = true
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	private var expandAnimation: Animation? {
		reduceMotion ? nil : .easeOut(duration: 0.2)
	}

	private var changeKind: ProjectTreeChangeKind? {
		changeKinds[entry.relativePath]
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			Button {
				if entry.isDirectory {
					withAnimation(expandAnimation) {
						isExpanded.toggle()
					}
				} else {
					RevealInFinder.openWithDefaultApp(path: absolutePath)
				}
			} label: {
				HStack(spacing: 6) {
					if entry.isDirectory {
						Image(systemName: "chevron.right")
							.font(.system(size: 10, weight: .semibold))
							.frame(width: 12)
							.foregroundStyle(AppTheme.tertiaryText)
							.rotationEffect(.degrees(isExpanded ? 90 : 0))
					} else {
						Color.clear
							.frame(width: 12, height: 1)
					}
					Image(systemName: entry.isDirectory ? "folder" : "doc")
						.foregroundStyle(entry.isDirectory ? AppTheme.accent : AppTheme.secondaryText)
					Text(entry.name)
						.font(.system(size: 12))
						.lineLimit(1)
					if let changeKind {
						Text(changeKind.label)
							.font(.caption2.weight(.semibold))
							.foregroundStyle(changeForeground(changeKind))
					}
					Spacer(minLength: 0)
				}
				.padding(.leading, CGFloat(depth) * 14)
				.padding(.horizontal, 4)
				.padding(.vertical, 3)
			}
			.buttonStyle(.plain)
			.background(changeBackground)
			.clipShape(.rect(cornerRadius: 4))
			.help(entry.isDirectory ? (isExpanded ? "Collapse folder" : "Expand folder") : "Open with default app")
			.accessibilityLabel(entry.isDirectory ? entry.name : "Open \(entry.name)")
			.accessibilityValue(accessibilityValue)
			if entry.isDirectory, isExpanded {
				VStack(alignment: .leading, spacing: 2) {
					ForEach(entry.children ?? []) { child in
						ProjectTreeRow(
							entry: child,
							projectFolderPath: projectFolderPath,
							depth: depth + 1,
							changeKinds: changeKinds
						)
					}
				}
				.transition(
					reduceMotion
						? .opacity
						: .opacity.combined(with: .move(edge: .top))
				)
			}
		}
		.clipped()
		.animation(expandAnimation, value: isExpanded)
	}

	private var absolutePath: String {
		URL(fileURLWithPath: entry.relativePath, relativeTo: URL(fileURLWithPath: projectFolderPath, isDirectory: true))
			.standardizedFileURL
			.path
	}

	private var accessibilityValue: String {
		[
			entry.isDirectory ? (isExpanded ? "Expanded" : "Collapsed") : nil,
			changeKind?.label,
		]
		.compactMap { $0 }
		.joined(separator: ", ")
	}

	@ViewBuilder
	private var changeBackground: some View {
		if let changeKind {
			switch changeKind {
			case .added:
				AppTheme.statusSuccessBackground
			case .updated:
				AppTheme.accent.opacity(0.14)
			case .deleted:
				AppTheme.statusErrorBackground
			}
		} else {
			Color.clear
		}
	}

	private func changeForeground(_ kind: ProjectTreeChangeKind) -> Color {
		switch kind {
		case .added:
			AppTheme.statusSuccessForeground
		case .updated:
			AppTheme.accent
		case .deleted:
			AppTheme.statusErrorForeground
		}
	}
}

enum ProjectFilesInspectorLayout {
	static let minWidth: CGFloat = 220
	static let idealWidth: CGFloat = 280
	static let maxWidth: CGFloat = 400
}

struct ProjectFilesSidebarView: View {
	@Bindable var store: ProjectsStore

	private var changeKinds: [String: ProjectTreeChangeKind] {
		Dictionary(
			uniqueKeysWithValues: store.treeChanges
				.filter { $0.kind != .deleted }
				.map { ($0.entry.relativePath, $0.kind) }
		)
	}

	private var deletedChanges: [ProjectTreeChange] {
		store.treeChanges.filter { $0.kind == .deleted }
	}

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 16) {
				ProjectFileTreeSection(store: store, changeKinds: changeKinds)
				if !deletedChanges.isEmpty {
					recentlyDeleted
				}
			}
			.padding(16)
			.frame(maxWidth: .infinity, alignment: .topLeading)
		}
		.automaticScrollIndicators(axes: .vertical)
		.background(AppTheme.contentBackground)
		.accessibilityIdentifier("project-files-sidebar")
	}

	private var recentlyDeleted: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Recently deleted")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			ForEach(deletedChanges) { change in
				HStack(spacing: 6) {
					Image(systemName: change.entry.isDirectory ? "folder.badge.minus" : "doc.badge.minus")
						.foregroundStyle(AppTheme.statusErrorForeground)
					Text(change.entry.name)
						.font(.system(size: 12))
						.lineLimit(1)
					Text(change.kind.label)
						.font(.caption2.weight(.semibold))
						.foregroundStyle(AppTheme.statusErrorForeground)
					Spacer(minLength: 0)
				}
				.padding(4)
				.background(AppTheme.statusErrorBackground)
				.clipShape(.rect(cornerRadius: 4))
				.accessibilityElement(children: .combine)
				.accessibilityLabel("Deleted \(change.entry.name)")
				.accessibilityValue("Deleted")
			}
		}
	}
}
