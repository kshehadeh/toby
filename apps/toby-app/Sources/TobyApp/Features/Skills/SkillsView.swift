import SwiftUI

struct SkillsView: View {
	@Bindable var store: SkillsStore
	@State private var preferList = false

	var body: some View {
		FeatureWorkspaceSplit(
			listTitle: "Skills",
			isShowingList: preferList || store.selectedSkill == nil,
			onShowList: { preferList = true }
		) {
			SkillsSidebarView(store: store, onDelete: { item in
				store.pendingDelete = SkillsStore.PendingDelete(
					dirName: item.dirName, name: item.name
				)
			})
		} detail: {
			SkillsDetailView(store: store)
		}
		.onChange(of: store.selectedSkillId) { _, id in
			if id != nil { preferList = false }
		}
		.task {
			await store.ensureLoaded()
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
