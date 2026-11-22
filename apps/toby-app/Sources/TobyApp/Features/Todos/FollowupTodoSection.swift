import Observation
import SwiftUI

@Observable @MainActor
final class FollowupTodoDetailStore {
	var detail: FollowupDetail?
	var errorMessage: String?
	var lookupError: String?
	var isWorking = false
	var isLoading = false
	@ObservationIgnored private let client: TobyClient
	@ObservationIgnored private var loadedTodoId: String?
	@ObservationIgnored private var lookupTask: Task<Void, Never>?

	init(client: TobyClient = TobyClient()) {
		self.client = client
	}

	func load(todoId: String, force: Bool = false) async {
		guard force || loadedTodoId != todoId || lookupError != nil else {
			await lookupTask?.value
			return
		}
		lookupTask?.cancel()
		isLoading = true
		loadedTodoId = todoId
		if detail?.todoId != todoId { detail = nil }
		lookupError = nil
		errorMessage = nil
		let request = Task { @MainActor [weak self] in
			guard let self else { return }
			do {
				let result = try await self.client.fetchFollowupDetail(todoId: todoId)
				guard !Task.isCancelled, self.loadedTodoId == todoId else { return }
				self.detail = result
			} catch {
				guard !Task.isCancelled, self.loadedTodoId == todoId else { return }
				self.lookupError = error.localizedDescription
			}
			if !Task.isCancelled, self.loadedTodoId == todoId { self.isLoading = false }
		}
		lookupTask = request
		await request.value
	}

	func loadIfNeeded(todoId: String) async {
		await load(todoId: todoId)
	}

	func reopen(todoId: String) async {
		guard !isWorking else { return }
		isWorking = true
		defer { isWorking = false }
		do {
			try await client.sendFollowupAction(todoId: todoId, action: "reopen")
			let refreshed = try await client.fetchFollowupDetail(todoId: todoId)
			guard loadedTodoId == todoId else { return }
			detail = refreshed
			lookupError = nil
			errorMessage = nil
		} catch {
			guard loadedTodoId == todoId else { return }
			errorMessage = error.localizedDescription
		}
	}

	func markNotUseful(todoId: String) async {
		guard !isWorking else { return }
		isWorking = true
		defer { isWorking = false }
		do {
			try await client.sendFollowupAction(
				todoId: todoId,
				action: "feedback",
				body: ["outcome": "not_useful"]
			)
			guard loadedTodoId == todoId else { return }
			detail = nil
			errorMessage = nil
		} catch {
			guard loadedTodoId == todoId else { return }
			errorMessage = error.localizedDescription
		}
	}
}

struct FollowupTodoSection: View {
	@Bindable var store: FollowupTodoDetailStore
	let todo: TobyTodo
	@State private var isConfirmingNotUseful = false

	var body: some View {
		if let detail = store.detail {
			content(detail)
				.confirmationDialog(
					"Remove this Toby-created todo?",
					isPresented: $isConfirmingNotUseful,
					titleVisibility: .visible
				) {
					Button("Not useful, delete todo", role: .destructive) {
						Task { await store.markNotUseful(todoId: todo.id) }
					}
					Button("Cancel", role: .cancel) {}
				} message: {
					Text("Toby will delete the todo and remember not to suggest this follow-up again.")
				}
		} else if store.isLoading {
			ProgressView("Loading follow-up explanation…")
		} else if let error = store.lookupError {
			DetailSection(title: "Follow-up explanation unavailable") {
				InlineStatusMessage(message: error, tone: .error)
				Button("Try again") { Task { await store.load(todoId: todo.id) } }
			}
		}
	}

	private func content(_ detail: FollowupDetail) -> some View {
		DetailSection(title: "Why Toby added this") {
			VStack(alignment: .leading, spacing: 12) {
				Text("Toby thinks this needs attention based on the activity below.")
					.font(.callout)
					.foregroundStyle(AppTheme.secondaryText)

				DetailMetadataStack {
					DetailMetadataRow(label: "Type", value: Self.kindLabel(detail.kind))
					DetailMetadataRow(label: "Confidence", value: "\(Int((detail.confidence * 100).rounded()))%")
					if let counterpart = detail.counterpart {
						DetailMetadataRow(label: "With", value: counterpart)
					}
					if let dueAt = detail.dueAt {
						DetailMetadataRow(label: "Due", value: Self.readableDate(dueAt))
					}
				}

				if !detail.evidence.isEmpty {
					VStack(alignment: .leading, spacing: 10) {
						ForEach(detail.evidence) { evidence in
							VStack(alignment: .leading, spacing: 3) {
								if let url = evidence.url.flatMap(URL.init(string:)) {
									Link(destination: url) {
										Label(evidence.title, systemImage: "arrow.up.right.square")
										.lineLimit(2)
									}
									.accessibilityIdentifier("followup-evidence-\(evidence.id)")
								} else {
									Text(evidence.title)
									.font(.callout.weight(.medium))
								}
								Text(evidence.reason)
									.font(.callout)
									.foregroundStyle(AppTheme.secondaryText)
									.fixedSize(horizontal: false, vertical: true)
								Text(Self.readableDate(evidence.occurredAt))
									.font(.caption)
									.foregroundStyle(AppTheme.tertiaryText)
							}
						}
					}
				} else {
					Text("No source activity is available to show.")
						.font(.callout)
						.foregroundStyle(AppTheme.secondaryText)
				}

				if let error = store.errorMessage {
					InlineStatusMessage(message: error, tone: .error)
				}
				if let error = store.lookupError {
					InlineStatusMessage(message: error, tone: .error)
					Button("Try again") { Task { await store.load(todoId: todo.id) } }
				}

				HStack(spacing: 10) {
					if todo.state.status == "completed", !todo.deleted {
						Button("Reopen", systemImage: "arrow.uturn.backward") {
							Task { await store.reopen(todoId: todo.id) }
						}
						.accessibilityIdentifier("followup-reopen")
					}
					if !todo.deleted, detail.status != "dismissed", detail.status != "expired" {
						Button("Not useful", systemImage: "hand.thumbsdown") {
							isConfirmingNotUseful = true
						}
						.accessibilityIdentifier("followup-not-useful")
					}
				}
				.disabled(store.isWorking)
			}
		}
	}

	private static func kindLabel(_ kind: String) -> String {
		switch kind {
		case "owe_reply": "You owe a reply"
		case "awaiting_reply": "Waiting for a reply"
		case "commitment": "Commitment"
		default: kind.replacingOccurrences(of: "_", with: " ").capitalized
		}
	}

	private static func readableDate(_ value: String) -> String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		guard let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value) else {
			return value
		}
		return date.formatted(date: .abbreviated, time: .shortened)
	}
}
