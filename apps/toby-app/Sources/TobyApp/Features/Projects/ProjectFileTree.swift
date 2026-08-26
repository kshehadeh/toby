import SwiftUI

struct ProjectFileTreeSection: View {
	@Bindable var store: ProjectsStore

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
							depth: 0
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
	@State private var isExpanded = true
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	private var expandAnimation: Animation? {
		reduceMotion ? nil : .easeOut(duration: 0.2)
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
					Spacer(minLength: 0)
				}
				.padding(.leading, CGFloat(depth) * 14)
				.padding(.vertical, 3)
			}
			.buttonStyle(.plain)
			.help(entry.isDirectory ? (isExpanded ? "Collapse folder" : "Expand folder") : "Open with default app")
			.accessibilityLabel(entry.isDirectory ? entry.name : "Open \(entry.name)")
			.accessibilityValue(entry.isDirectory ? (isExpanded ? "Expanded" : "Collapsed") : "")
			if entry.isDirectory, isExpanded {
				VStack(alignment: .leading, spacing: 2) {
					ForEach(entry.children ?? []) { child in
						ProjectTreeRow(
							entry: child,
							projectFolderPath: projectFolderPath,
							depth: depth + 1
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
}
