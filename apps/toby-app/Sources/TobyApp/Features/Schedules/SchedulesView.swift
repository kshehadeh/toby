import SwiftUI

struct SchedulesView: View {
	@Bindable var store: SchedulesStore

	var body: some View {
		SchedulesDetailView(store: store, onDelete: { schedule in
			store.pendingDelete = SchedulesStore.PendingDelete(scheduleId: schedule.id, title: schedule.displayName)
		})
		.toolbarBackground(.visible)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.load()
		}
		.onDisappear {
			Task { await store.flushPendingSave() }
			store.closeRunDetail()
		}
		.sheet(isPresented: Binding(
			get: { store.selectedRunId != nil },
			set: { if !$0 { store.closeRunDetail() } }
		)) {
			if let run = store.selectedRunDetail {
				ScheduleRunDetailView(run: run, isLoading: store.isRunDetailLoading, error: store.runDetailError)
			} else {
				ScheduleRunDetailView(run: nil, isLoading: store.isRunDetailLoading, error: store.runDetailError)
			}
		}
		.alert(
			"Delete Schedule?",
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
				Task { await store.deleteSchedule(id: pending.scheduleId) }
			}
		} message: { pending in
			Text("Are you sure you want to delete \"\(pending.title)\"? This cannot be undone.")
		}
	}
}
