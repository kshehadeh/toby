import SwiftUI

struct PermissionsView: View {
	@State private var store = PermissionsStore()

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 12) {
				ForEach(store.statuses) { status in
					PermissionCard(
						status: status,
						onAllow: { await store.request(status.kind) },
						onOpenSettings: { store.openPrivacySettings(for: status.kind) },
					)
				}

				Spacer(minLength: 0)
			}
			.padding(AppTheme.contentPadding)
			.frame(maxWidth: .infinity, alignment: .topLeading)
		}
		.background(SettingsDesign.canvasBackground)
		.frame(minWidth: 520, minHeight: 420)
		.task {
			store.refresh()
			while !Task.isCancelled {
				try? await Task.sleep(nanoseconds: 1_000_000_000)
				store.refresh()
			}
		}
	}
}

