import SwiftUI

struct ChangelogView: View {
	@Bindable var store: ChangelogStore
	var updateStore: UpdateStore?
	var onDismiss: (() -> Void)? = nil

	private let dateFormatter: DateFormatter = {
		let formatter = DateFormatter()
		formatter.dateStyle = .medium
		formatter.timeStyle = .none
		return formatter
	}()

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			changelogHeader

			ChangelogReleasesView(store: store, updateStore: updateStore, dateFormatter: dateFormatter)
		}
		.padding(24)
		.frame(minWidth: 480, idealWidth: 520, maxWidth: 560, minHeight: 400, idealHeight: 520, maxHeight: 640)
		.background(AppTheme.contentBackground)
		.task {
			await store.load()
		}
	}

	private var changelogHeader: some View {
		HStack {
			Button {
				Task { await store.load(force: true) }
			} label: {
				Text("Refresh")
			}
			.buttonStyle(.link)
			.disabled(store.isLoading)
			.accessibilityLabel("Refresh changelog")

			Spacer()

			if let updateStore, updateStore.isUpdateAvailable, let latest = updateStore.latestVersion {
				Button {
					onDismiss?()
					Task { await updateStore.performUpgrade() }
				} label: {
					Text("Upgrade to v\(latest)")
				}
				.disabled(updateStore.isUpgrading)
				.accessibilityLabel("Upgrade to version \(latest)")
			}

			Button("Done") {
				onDismiss?()
			}
			.accessibilityLabel("Close changelog")
		}
		.padding(.bottom, 16)
	}
}
