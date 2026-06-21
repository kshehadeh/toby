import SwiftUI

struct ChangelogView: View {
	@Bindable var store: ChangelogStore

	private let dateFormatter: DateFormatter = {
		let formatter = DateFormatter()
		formatter.dateStyle = .medium
		formatter.timeStyle = .none
		return formatter
	}()

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if store.isLoading && store.changelog == nil {
				ChangelogSkeletonView()
			} else if let errorMessage = store.errorMessage {
				Text(errorMessage)
					.font(.callout)
					.foregroundStyle(.red)
					.fixedSize(horizontal: false, vertical: true)
					.padding(.top, 8)
			} else if let releases = store.changelog?.releases, !releases.isEmpty {
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
			} else if !store.isLoading {
				Text("No recent changes available.")
					.font(.callout)
					.foregroundStyle(AppTheme.secondaryText)
					.padding(.top, 20)
			}
		}
		.padding(24)
		.frame(minWidth: 480, idealWidth: 520, maxWidth: 560, minHeight: 400, idealHeight: 520, maxHeight: 640)
		.background(AppTheme.contentBackground)
		.background(WindowAccessor { window in
			window.styleMask.remove([.miniaturizable, .resizable])
		})
		.toolbar {
			ToolbarItem(placement: .primaryAction) {
				Button {
					Task { await store.load(force: true) }
				} label: {
					Image(systemName: "arrow.clockwise")
				}
				.help("Refresh changelog")
				.disabled(store.isLoading)
				.accessibilityLabel("Refresh changelog")
			}
		}
		.task {
			await store.load()
		}
	}
}

private struct ChangelogSkeletonView: View {
	@State private var pulse = false

	var body: some View {
		VStack(alignment: .leading, spacing: 24) {
			ForEach(0..<4) { index in
				VStack(alignment: .leading, spacing: 12) {
					HStack {
						RoundedRectangle(cornerRadius: 4)
							.fill(AppTheme.panelBackground)
							.frame(width: 120, height: 18)
						Spacer()
						RoundedRectangle(cornerRadius: 4)
							.fill(AppTheme.panelBackground)
							.frame(width: 80, height: 14)
					}
					VStack(alignment: .leading, spacing: 8) {
						RoundedRectangle(cornerRadius: 4)
							.fill(AppTheme.panelBackground)
							.frame(height: 14)
						RoundedRectangle(cornerRadius: 4)
							.fill(AppTheme.panelBackground)
							.frame(width: 240, height: 14)
					}
				}
				if index != 3 {
					Divider()
						.background(AppTheme.separator)
				}
			}
		}
		.opacity(pulse ? 0.5 : 1.0)
		.animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: pulse)
		.onAppear { pulse = true }
		.accessibilityIdentifier("changelog-skeleton")
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
