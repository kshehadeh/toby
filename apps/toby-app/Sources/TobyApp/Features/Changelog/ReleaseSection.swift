import SwiftUI

struct ReleaseSection: View {
	let release: ChangelogRelease
	let dateFormatter: DateFormatter

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			HStack(alignment: .firstTextBaseline, spacing: 8) {
				Text(release.version)
					.font(.headline)
					.foregroundStyle(AppTheme.primaryText)
				Spacer()
				if let date = ISO8601DateFormatter().date(from: release.publishedAt) {
					Text(dateFormatter.string(from: date))
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
				}
			}

			if !release.features.isEmpty {
				ChangeGroup(title: "Features", icon: "star.fill", color: AppTheme.accent, changes: release.features)
			}
			if !release.bugs.isEmpty {
				ChangeGroup(title: "Bug fixes", icon: "ladybug.fill", color: .red, changes: release.bugs)
			}
			if !release.enhancements.isEmpty {
				ChangeGroup(title: "Enhancements", icon: "wrench.adjustable.fill", color: .cyan, changes: release.enhancements)
			}

			if let url = URL(string: release.url) {
				Link(destination: url) {
					Label("View release on GitHub", systemImage: "arrow.up.right.square")
						.font(.caption)
						.foregroundStyle(AppTheme.accent)
				}
				.padding(.top, 4)
			}
		}
	}
}
