import SwiftUI

/// Todo-specific sync status inside Settings → Sync and Backup.
struct TodoSyncSettingsSection: View {
	var client = TobyClient()
	@State private var status: TodoSyncStatus?
	@State private var errorMessage: String?
	@State private var isWorking = false
	@State private var pendingMerge = false

	var body: some View {
		Section("Todos") {
			LabeledContent("Last synced", value: lastSynced)
			LabeledContent("Pending changes", value: status?.pending.map(String.init) ?? "—")
			if let message = errorMessage ?? status?.error {
				InlineStatusMessage(message: message, tone: .error, font: .caption)
			}
			if status?.pausedForRestore == true {
				Text("Todo sync and reminders are paused after a data restore. Review the restored todos, then merge them with changes from your other Macs.")
					.font(.caption).foregroundStyle(AppTheme.secondaryText)
				Button("Review and merge…") { pendingMerge = true }
					.disabled(isWorking)
					.accessibilityIdentifier("todo-sync-merge")
			} else {
				Button("Sync todos now") { Task { await syncNow() } }
					.disabled(isWorking)
					.accessibilityIdentifier("todo-sync-now")
			}
		}
		.task { await load() }
		.alert("Merge restored todos?", isPresented: $pendingMerge) {
			Button("Cancel", role: .cancel) {}
			Button("Merge") { Task { await merge() } }
		} message: {
			Text("Toby keeps the restored todos and merges them with the sync destination. Conflicting edits pick one winner and keep the other value in each todo's history. Missed reminders are not replayed.")
		}
	}

	private var lastSynced: String {
		guard let value = status?.lastSuccess else { return "Never" }
		return TodoHistoryList.timestamp(value)
	}

	private func load() async {
		do { status = try await client.todoSyncStatus(); errorMessage = nil }
		catch { errorMessage = error.localizedDescription }
	}
	private func syncNow() async {
		isWorking = true
		defer { isWorking = false }
		do { status = try await client.syncTodosNow(); errorMessage = nil }
		catch { errorMessage = error.localizedDescription; await refreshStatusOnly() }
	}
	private func merge() async {
		isWorking = true
		defer { isWorking = false }
		do { status = try await client.reconcileRestoredTodos(); errorMessage = nil }
		catch { errorMessage = error.localizedDescription }
	}
	private func refreshStatusOnly() async {
		if let fresh = try? await client.todoSyncStatus() { status = fresh }
	}
}
