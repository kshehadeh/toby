import SwiftUI

struct IntegrationsView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		IntegrationsDetailView(store: store)
		.toolbarBackground(.visible)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.load()
			if let first = store.integrationSections.first,
				store.selectedNavKey == nil || !store.integrationSections.contains(where: { ($0.navKey ?? $0.key) == store.selectedNavKey })
			{
				store.selectedNavKey = first.navKey ?? first.key
			}
		}
		.onDisappear {
			Task { await store.flushPendingSave() }
		}
		.sheet(
			isPresented: Binding(
				get: { store.setupGuidePresented },
				set: { if !$0 { store.dismissSetupGuide() } },
			),
		) {
			if let section = store.selectedSection {
				IntegrationSetupWizardView(store: store, section: section)
			}
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
	}
}

extension ConfigureStore {
	var integrationSections: [SettingsItem] {
		guard let tree,
			let integrations = ConfigureTreeHelpers.findSectionByNavKey(tree, navKey: "integrations")
		else {
			return []
		}
		return (integrations.children ?? []).filter { $0.kind == .section }
	}
}
