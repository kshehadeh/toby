import SwiftUI

struct IntegrationsView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		IntegrationsDetailView(store: store)
		.toolbarBackground(.visible)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.load()
			if let selectedNavKey = store.selectedNavKey,
				!store.integrationSections.contains(where: {
					($0.navKey ?? $0.key) == selectedNavKey
				})
			{
				store.selectIntegrationHome()
			}
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

	func selectIntegrationHome() {
		selectedNavKey = nil
	}
}
