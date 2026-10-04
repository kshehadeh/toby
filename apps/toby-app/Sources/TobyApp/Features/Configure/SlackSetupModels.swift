import Foundation

struct IntegrationSetupState: Decodable {
    let ok: Bool
    let configuredFields: [String]
    let teamName: String?
    let activeIntegration: String?
    let persona: String
}

struct IntegrationGuidedSetupResponse: Decodable {
    let ok: Bool
    let details: Details
    struct Details: Decodable {
        let teamId: String?
        let teamName: String?
        let botUserId: String?
        let userTools: Bool?
        let inboundCredentials: Bool?
    }
}

extension TobyClient {
    func cancelIntegrationSetup(name: String) async {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/integrations/\(name)/setup-cancel"))
        request.httpMethod = "POST"
        _ = try? await URLSession.shared.data(for: request)
    }

    func fetchIntegrationSetupState(name: String) async throws -> IntegrationSetupState {
        let (data, response) = try await URLSession.shared.data(from: baseURL.appendingPathComponent("api/integrations/\(name)/setup-state"))
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
            throw TobyClientError.serverError("Toby couldn’t load setup progress. Update or restart the local server.")
        }
        return try JSONDecoder().decode(IntegrationSetupState.self, from: data)
    }

    func connectIntegrationSetup(name: String, fields: [String: String], stage: String, inbound: Bool) async throws -> IntegrationGuidedSetupResponse {
        struct Body: Encodable { let fields: [String: String]; let stage: String; let inbound: Bool }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/integrations/\(name)/setup-connect"))
        request.httpMethod = "POST"
        request.timeoutInterval = 125
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(fields: fields, stage: stage, inbound: inbound))
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
            struct Failure: Decodable { let error: String? }
            let error = try? JSONDecoder().decode(Failure.self, from: data)
            throw TobyClientError.serverError(error?.error ?? "Slack setup failed. Check the local server and try again.")
        }
        return try JSONDecoder().decode(IntegrationGuidedSetupResponse.self, from: data)
    }
}
