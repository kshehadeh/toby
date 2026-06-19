import SwiftUI

struct ChangelogView: View {
	let onDismiss: () -> Void

	@State private var changelog: ChangelogResponse?
	@State private var isLoading = false
	@State private var errorMessage: String?

	private let client = TobyClient()
	private let dateFormatter: DateFormatter = {
		let formatter = DateFormatter()
		formatter.dateStyle = .medium
		formatter.timeStyle = .none
		return formatter
	}()

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			HStack {
				Text("What’s new in Toby")
					.font(.title2)
					.fontWeight(.bold)
					.foregroundStyle(AppTheme.primaryText)
				Spacer()
				Button {
					onDismiss()
				} label: {
					Image(systemName: "xmark")
						.font(.title3)
						.foregroundStyle(AppTheme.secondaryText)
				}
				.buttonStyle(.plain)
				.accessibilityLabel("Close")
			}
			.padding(.bottom, 16)

			if isLoading && changelog == nil {
				ProgressView("Loading changelog…")
					.controlSize(.small)
					.foregroundStyle(AppTheme.secondaryText)
					.padding(.top, 20)
			} else if let errorMessage {
				Text(errorMessage)
					.font(.callout)
					.foregroundStyle(.red)
					.fixedSize(horizontal: false, vertical: true)
					.padding(.top, 8)
			} else if let releases = changelog?.releases, !releases.isEmpty {
				ScrollView {
					LazyVStack(alignment: .leading, spacing: 20) {
						ForEach(releases) { release in
							ReleaseSection(
								release: release,
								dateFormatter: dateFormatter,
							)
							if release.id != releases.last?.id {
								Divider()
									.background(AppTheme.separator)
							}
						}
					}
					.padding(.bottom, 8)
				}
			} else if !isLoading {
				Text("No recent changes available.")
					.font(.callout)
					.foregroundStyle(AppTheme.secondaryText)
					.padding(.top, 20)
			}
		}
		.padding(24)
		.frame(minWidth: 480, idealWidth: 520, maxWidth: 560, minHeight: 400, idealHeight: 520, maxHeight: 640)
		.background(AppTheme.contentBackground)
		.task {
			await loadChangelog()
		}
	}

	private func loadChangelog() async {
		guard !isLoading else { return }
		isLoading = true
		defer { isLoading = false }
		errorMessage = nil
		do {
			changelog = try await client.fetchChangelog(limit: 10)
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}

private struct ReleaseSection: View {
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

private struct ChangeGroup: View {
	let title: String
	let icon: String
	let color: Color
	let changes: [ChangelogChange]

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(spacing: 6) {
				Image(systemName: icon)
					.foregroundStyle(color)
					.font(.caption2)
				Text(title)
					.font(.caption)
					.fontWeight(.semibold)
					.foregroundStyle(color)
				Spacer()
			}

			ForEach(changes) { change in
				HStack(alignment: .top, spacing: 6) {
					Text("•")
						.foregroundStyle(AppTheme.tertiaryText)
						.font(.callout)
					Text(changeText(change))
						.font(.callout)
						.foregroundStyle(AppTheme.primaryText)
						.fixedSize(horizontal: false, vertical: true)
					Spacer(minLength: 0)
				}
			}
		}
	}

	private func changeText(_ change: ChangelogChange) -> String {
		if let scope = change.scope, !scope.isEmpty {
			return "[\(scope)] \(change.description)"
		}
		return change.description
	}
}
