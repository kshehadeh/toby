import Foundation

private func validateFollowupsResponse(_ response: URLResponse, data: Data) throws {
	guard let http = response as? HTTPURLResponse else { throw TobyClientError.invalidResponse }
	guard (200..<300).contains(http.statusCode) else {
		let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
		throw TobyClientError.serverError(json?["error"] as? String ?? "Follow-up request failed (\(http.statusCode)).")
	}
}

extension TobyClient {
	func runFollowupsNow() async throws -> FollowupsRunResult {
		let result = try JSONDecoder().decode(FollowupsRunResult.self, from: try await NativeRuntime.shared.followups().runNow())
		guard result.status == "ok" else { throw TobyClientError.serverError(result.error ?? "Toby could not check follow-ups.") }
		return result
	}

	func fetchFollowupsSettings() async throws -> FollowupsSettingsResponse { return try JSONDecoder().decode(FollowupsSettingsResponse.self, from: try await NativeRuntime.shared.followups().settings())
	}

	func saveFollowupsSettings(_ settings: FollowupsSettingsConfig, sourceDefaults: [String: Bool]) async throws -> FollowupsSettingsResponse {
		let body = try JSONSerialization.data(withJSONObject: settings.requestBody(sourceDefaults: sourceDefaults))
		return try JSONDecoder().decode(FollowupsSettingsResponse.self, from: try await NativeRuntime.shared.followups().saveSettings(body))
	}

	func fetchFollowupSources() async throws -> [FollowupSource] {
		struct Payload: Decodable { let sources: [FollowupSource] }
		return try JSONDecoder().decode(Payload.self, from: try await NativeRuntime.shared.followups().sources()).sources
	}

	func fetchFollowupInstructions() async throws -> [FollowupInstruction] { return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: try await NativeRuntime.shared.followups().instructions()).instructions
	}

	func addFollowupInstruction(_ text: String) async throws -> [FollowupInstruction] { return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: try await NativeRuntime.shared.followups().addInstruction(text)).instructions
	}

	func updateFollowupInstruction(id: String, text: String) async throws -> [FollowupInstruction] { return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: try await NativeRuntime.shared.followups().updateInstruction(id, text)).instructions
	}

	func deleteFollowupInstruction(id: String) async throws -> [FollowupInstruction] { return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: try await NativeRuntime.shared.followups().deleteInstruction(id)).instructions
	}

	func fetchFollowupDetail(todoId: String) async throws -> FollowupDetail? { return try await NativeRuntime.shared.followups().detail(todoId).map { try JSONDecoder().decode(FollowupDetail.self, from: $0) }
	}

	func sendFollowupAction(todoId: String, action: String, body: [String: Any] = [:]) async throws {
		let outcome = body["outcome"] as? String
		try await NativeRuntime.shared.followups().action(todoId, action, outcome: outcome)
		NotificationCenter.default.post(name: .todosDidChange, object: nil)
		return
	}
}
