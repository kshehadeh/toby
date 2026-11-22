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
		if NativeMode.isEnabled {
			let result = try JSONDecoder().decode(FollowupsRunResult.self, from: try await NativeRuntime.shared.followups().runNow())
			guard result.status == "ok" else { throw TobyClientError.serverError(result.error ?? "Toby could not check follow-ups.") }
			return result
		}
		var request = URLRequest(url: baseURL.appendingPathComponent("api/followups/run"))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = Data("{}".utf8)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validateFollowupsResponse(response, data: data)
		let result = try JSONDecoder().decode(FollowupsRunResult.self, from: data)
		guard result.status == "ok" else {
			let message = result.error ?? (result.status == "disabled"
				? "Enable automatic follow-ups before checking activity."
				: "Toby could not check follow-ups. Check the evaluator settings and try again.")
			throw TobyClientError.serverError(message)
		}
		return result
	}

	func fetchFollowupsSettings() async throws -> FollowupsSettingsResponse {
		if NativeMode.isEnabled { return try JSONDecoder().decode(FollowupsSettingsResponse.self, from: try await NativeRuntime.shared.followups().settings()) }
		let url = baseURL.appendingPathComponent("api/followups/config")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validateFollowupsResponse(response, data: data)
		return try JSONDecoder().decode(FollowupsSettingsResponse.self, from: data)
	}

	func saveFollowupsSettings(_ settings: FollowupsSettingsConfig, sourceDefaults: [String: Bool]) async throws -> FollowupsSettingsResponse {
		if NativeMode.isEnabled {
			let body = try JSONSerialization.data(withJSONObject: settings.requestBody(sourceDefaults: sourceDefaults))
			return try JSONDecoder().decode(FollowupsSettingsResponse.self, from: try await NativeRuntime.shared.followups().saveSettings(body))
		}
		var request = URLRequest(url: baseURL.appendingPathComponent("api/followups/config"))
		request.httpMethod = "PUT"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = try JSONSerialization.data(withJSONObject: settings.requestBody(sourceDefaults: sourceDefaults))
		let (data, response) = try await URLSession.shared.data(for: request)
		try validateFollowupsResponse(response, data: data)
		return try JSONDecoder().decode(FollowupsSettingsResponse.self, from: data)
	}

	func fetchFollowupSources() async throws -> [FollowupSource] {
		if NativeMode.isEnabled {
			struct Payload: Decodable { let sources: [FollowupSource] }
			return try JSONDecoder().decode(Payload.self, from: try await NativeRuntime.shared.followups().sources()).sources
		}
		let url = baseURL.appendingPathComponent("api/followups/sources")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validateFollowupsResponse(response, data: data)
		struct Payload: Decodable { let sources: [FollowupSource] }
		return try JSONDecoder().decode(Payload.self, from: data).sources
	}

	func fetchFollowupInstructions() async throws -> [FollowupInstruction] {
		if NativeMode.isEnabled { return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: try await NativeRuntime.shared.followups().instructions()).instructions }
		let url = baseURL.appendingPathComponent("api/followups/instructions")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validateFollowupsResponse(response, data: data)
		return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: data).instructions
	}

	func addFollowupInstruction(_ text: String) async throws -> [FollowupInstruction] {
		if NativeMode.isEnabled { return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: try await NativeRuntime.shared.followups().addInstruction(text)).instructions }
		var request = URLRequest(url: baseURL.appendingPathComponent("api/followups/instructions"))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = try JSONSerialization.data(withJSONObject: ["text": text])
		let (data, response) = try await URLSession.shared.data(for: request)
		try validateFollowupsResponse(response, data: data)
		return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: data).instructions
	}

	func updateFollowupInstruction(id: String, text: String) async throws -> [FollowupInstruction] {
		if NativeMode.isEnabled { return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: try await NativeRuntime.shared.followups().updateInstruction(id, text)).instructions }
		var request = URLRequest(url: baseURL.appendingPathComponent("api/followups/instructions/\(id)"))
		request.httpMethod = "PATCH"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = try JSONSerialization.data(withJSONObject: ["text": text])
		let (data, response) = try await URLSession.shared.data(for: request)
		try validateFollowupsResponse(response, data: data)
		return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: data).instructions
	}

	func deleteFollowupInstruction(id: String) async throws -> [FollowupInstruction] {
		if NativeMode.isEnabled { return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: try await NativeRuntime.shared.followups().deleteInstruction(id)).instructions }
		var request = URLRequest(url: baseURL.appendingPathComponent("api/followups/instructions/\(id)"))
		request.httpMethod = "DELETE"
		let (data, response) = try await URLSession.shared.data(for: request)
		try validateFollowupsResponse(response, data: data)
		return try JSONDecoder().decode(FollowupInstructionListResponse.self, from: data).instructions
	}

	func fetchFollowupDetail(todoId: String) async throws -> FollowupDetail? {
		if NativeMode.isEnabled { return try await NativeRuntime.shared.followups().detail(todoId).map { try JSONDecoder().decode(FollowupDetail.self, from: $0) } }
		let url = baseURL.appendingPathComponent("api/followups/\(todoId)")
		let (data, response) = try await URLSession.shared.data(from: url)
		if (response as? HTTPURLResponse)?.statusCode == 404 { return nil }
		try validateFollowupsResponse(response, data: data)
		return try JSONDecoder().decode(FollowupDetail.self, from: data)
	}

	func sendFollowupAction(todoId: String, action: String, body: [String: Any] = [:]) async throws {
		if NativeMode.isEnabled {
			let outcome = body["outcome"] as? String
			try await NativeRuntime.shared.followups().action(todoId, action, outcome: outcome)
			NotificationCenter.default.post(name: .todosDidChange, object: nil)
			return
		}
		var request = URLRequest(url: baseURL.appendingPathComponent("api/followups/\(todoId)/\(action)"))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = try JSONSerialization.data(withJSONObject: body)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validateFollowupsResponse(response, data: data)
		NotificationCenter.default.post(name: .todosDidChange, object: nil)
	}
}
