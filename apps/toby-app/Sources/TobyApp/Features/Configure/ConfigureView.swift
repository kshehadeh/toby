import SwiftUI

struct ConfigureView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		ConfigureDetailView(store: store)
		.toolbarBackground(.visible)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.loadSettingsSections()
		}
		.onDisappear {
			Task { await store.flushPendingSave() }
		}
		.alert(
			store.pendingDelete?.title ?? "",
			isPresented: Binding(
				get: { store.pendingDelete != nil },
				set: { if !$0 { store.pendingDelete = nil } },
			),
		) {
			Button("Cancel", role: .cancel) {
				store.pendingDelete = nil
			}
			Button(store.pendingDelete?.confirmLabel ?? "Delete", role: .destructive) {
				Task { await store.confirmDelete() }
			}
		} message: {
			Text(store.pendingDelete?.message ?? "")
		}
		.sheet(
			isPresented: Binding(
				get: { store.setupGuidePresented },
				set: { if !$0 { store.dismissSetupGuide() } },
			),
		) {
			if let section = store.settingsSelectedSection ?? store.selectedSection {
				IntegrationSetupWizardView(store: store, section: section)
			}
		}
	}
}
