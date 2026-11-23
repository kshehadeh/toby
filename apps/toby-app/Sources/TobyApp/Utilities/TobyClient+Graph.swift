import Foundation

extension TobyClient {
	/// Best-connected visible nodes of `kinds` and the links among them.
	func fetchGraphSnapshot(kinds: Set<GraphNodeKind>, limit: Int) async throws -> GraphSnapshotResponse {
		let data = try NativeRuntime.shared.memories().graphSnapshot(types: kinds.map(\.rawValue).sorted(), limit: limit)
		return try JSONDecoder().decode(GraphSnapshotResponse.self, from: data)
	}
}
