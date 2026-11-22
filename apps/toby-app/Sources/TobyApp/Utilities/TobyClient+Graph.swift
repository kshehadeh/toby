import Foundation

extension TobyClient {
	/// Best-connected visible nodes of `kinds` and the links among them.
	func fetchGraphSnapshot(kinds: Set<GraphNodeKind>, limit: Int) async throws -> GraphSnapshotResponse {
		if NativeMode.isEnabled {
			let data = try await NativeRuntime.shared.memories().graphSnapshot(types: kinds.map(\.rawValue).sorted(), limit: limit)
			return try JSONDecoder().decode(GraphSnapshotResponse.self, from: data)
		}
		var components = URLComponents(
			url: baseURL.appendingPathComponent("api/graph"),
			resolvingAgainstBaseURL: false
		)!
		components.queryItems = [
			URLQueryItem(name: "types", value: kinds.map(\.rawValue).sorted().joined(separator: ",")),
			URLQueryItem(name: "limit", value: String(limit)),
		]
		var request = URLRequest(url: components.url!)
		request.cachePolicy = .reloadIgnoringLocalCacheData
		let (data, response) = try await URLSession.shared.data(for: request)
		guard let http = response as? HTTPURLResponse else { throw TobyClientError.invalidResponse }
		guard (200..<300).contains(http.statusCode) else {
			let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
			throw TobyClientError.serverError(
				json?["error"] as? String ?? "Couldn't load connections (\(http.statusCode))."
			)
		}
		return try JSONDecoder().decode(GraphSnapshotResponse.self, from: data)
	}
}
