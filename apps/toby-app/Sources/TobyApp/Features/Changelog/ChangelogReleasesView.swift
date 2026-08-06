import SwiftUI

struct ChangelogReleasesView: View {
	@Bindable var store: ChangelogStore
	var updateStore: UpdateStore?
	let dateFormatter: DateFormatter

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if store.isLoading && store.changelog == nil {
				ChangelogSkeletonView()
			} else if let errorMessage = store.errorMessage {
				InlineStatusMessage(message: errorMessage, tone: .error, font: .callout)
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
	}
}
