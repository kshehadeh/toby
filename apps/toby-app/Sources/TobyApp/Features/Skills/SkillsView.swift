import SwiftUI

struct SkillsView: View {
	@Bindable var store: SkillsStore

	var body: some View {
		SkillsDetailView(store: store)
		.toolbarBackground(.visible)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.load()
		}
		.onDisappear {
			Task { await store.flushPendingSave() }
		}
		.alert(
			"Delete Skill?",
			isPresented: Binding(
				get: { store.pendingDelete != nil },
				set: { if !$0 { store.pendingDelete = nil } },
			),
			presenting: store.pendingDelete,
		) { pending in
			Button("Cancel", role: .cancel) {
				store.pendingDelete = nil
			}
			Button("Delete", role: .destructive) {
				store.pendingDelete = nil
				Task { await store.deleteSkill(id: pending.dirName) }
			}
		} message: { pending in
			Text("Are you sure you want to delete \"\(pending.name)\"? This cannot be undone.")
		}
	}
}

extension SkillsStore {
	func key(for dirName: String, field: SkillField) -> String {
		"\(dirName).\(field.rawValue)"
	}
}
