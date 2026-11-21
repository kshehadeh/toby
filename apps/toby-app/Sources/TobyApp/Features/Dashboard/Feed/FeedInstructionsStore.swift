import Foundation
import Observation

/// The user's Feed instructions (`/api/dashboard/feed/instructions`).
/// Tracks whether anything changed so the caller can re-rank The Feed once
/// the editor closes instead of after every edit.
@Observable
@MainActor
final class FeedInstructionsStore {
	/// Newest first, for display.
	private(set) var instructions: [FeedInstruction] = []
	private(set) var isLoading = false
	private(set) var isSaving = false
	private(set) var error: String?
	/// True once an add / toggle / delete succeeds; cleared by `consumeChanges()`.
	private(set) var hasChanges = false

	struct Remote: Sendable {
		var list: @MainActor () async throws -> [FeedInstruction]
		var add: @MainActor (String) async throws -> [FeedInstruction]
		var setEnabled: @MainActor (String, Bool) async throws -> [FeedInstruction]
		var delete: @MainActor (String) async throws -> [FeedInstruction]
	}

	@ObservationIgnored
	private let remote: Remote

	init(client: TobyClient = TobyClient()) {
		self.remote = Remote(
			list: { try await client.listFeedInstructions() },
			add: { try await client.addFeedInstruction(text: $0) },
			setEnabled: { try await client.setFeedInstructionEnabled(id: $0, enabled: $1) },
			delete: { try await client.deleteFeedInstruction(id: $0) }
		)
	}

	/// Test seam.
	init(remote: Remote) {
		self.remote = remote
	}

	var enabledCount: Int { instructions.filter(\.enabled).count }

	func load() async {
		isLoading = true
		defer { isLoading = false }
		do {
			apply(try await remote.list())
			error = nil
		} catch {
			self.error = error.localizedDescription
		}
	}

	/// Adds `text` (trimmed). Returns true on success so the composer can clear.
	@discardableResult
	func add(_ text: String) async -> Bool {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty, !isSaving else { return false }
		return await mutate { try await self.remote.add(trimmed) }
	}

	func setEnabled(_ instruction: FeedInstruction, enabled: Bool) async {
		guard instruction.enabled != enabled else { return }
		_ = await mutate { try await self.remote.setEnabled(instruction.id, enabled) }
	}

	func delete(_ instruction: FeedInstruction) async {
		_ = await mutate { try await self.remote.delete(instruction.id) }
	}

	/// Returns whether anything changed since the last call, and resets it.
	func consumeChanges() -> Bool {
		defer { hasChanges = false }
		return hasChanges
	}

	private func mutate(_ operation: @MainActor () async throws -> [FeedInstruction]) async -> Bool {
		isSaving = true
		defer { isSaving = false }
		do {
			apply(try await operation())
			error = nil
			hasChanges = true
			return true
		} catch {
			self.error = error.localizedDescription
			return false
		}
	}

	private func apply(_ list: [FeedInstruction]) {
		instructions = list.reversed()
	}
}
