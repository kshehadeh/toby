import Foundation
import Observation

struct AIProviderOAuthStatus: Decodable {
    let id: String
    let state: String
    let authorizationUrl: String
    let expiresAt: Double
    let error: String?
}

@MainActor protocol AISetupOAuthClient {
    func startOpenRouterOAuth() async throws -> AIProviderOAuthStatus
    func fetchOpenRouterOAuth(id: String) async throws -> AIProviderOAuthStatus
    func finishOpenRouterOAuth(id: String) async throws -> AIProviderSetupResponse
    func cancelOpenRouterOAuth(id: String) async throws
}

/// Owns the browser handshake and polling; secrets stay in the daemon.
@Observable @MainActor
final class AISetupOAuthSession {
    enum Phase { case idle, starting, waiting, exchanging, authorized, testing, completed, failed }
    private(set) var phase: Phase = .idle
    private(set) var authorizationURL: URL?
    private(set) var error: String?
    private(set) var result: AIProviderSetupResponse?
    private var id: String?
    private var attempt = UUID()
    private var task: Task<Void, Never>?
    private let client: any AISetupOAuthClient
    private let pollInterval: Duration

    init(client: any AISetupOAuthClient = TobyClient(), pollInterval: Duration = .seconds(1)) {
        self.client = client
        self.pollInterval = pollInterval
    }
    var isActive: Bool { [.starting, .waiting, .exchanging, .authorized, .testing].contains(phase) }
    var isTesting: Bool { phase == .testing }

    func start(openBrowser: @escaping (URL) -> Bool) {
        guard !isActive else { return }
        error = nil
        result = nil
        phase = .starting
        let currentAttempt = UUID()
        attempt = currentAttempt
        task = Task {
            do {
                let session = try await client.startOpenRouterOAuth()
                guard attempt == currentAttempt, !Task.isCancelled else {
                    try? await client.cancelOpenRouterOAuth(id: session.id)
                    return
                }
                id = session.id
                guard let url = URL(string: session.authorizationUrl), url.scheme == "https", url.host == "openrouter.ai", url.path == "/auth" else {
                    throw TobyClientError.invalidResponse
                }
                authorizationURL = url
                guard openBrowser(url) else {
                    throw TobyClientError.serverError("Toby couldn’t open your browser. Try connecting again.")
                }
                phase = .waiting
                while !Task.isCancelled && attempt == currentAttempt {
                    let status = try await client.fetchOpenRouterOAuth(id: session.id)
                    guard attempt == currentAttempt, !Task.isCancelled else { return }
                    switch status.state {
                    case "waiting": phase = .waiting
                    case "exchanging": phase = .exchanging
                    case "authorized", "completed":
                        phase = .authorized
                        await finish(currentAttempt: currentAttempt)
                        return
                    case "error":
                        throw TobyClientError.serverError(status.error ?? "Sign-in ended. Please try again.")
                    default: throw TobyClientError.invalidResponse
                    }
                    try await Task.sleep(for: pollInterval)
                }
            } catch {
                guard attempt == currentAttempt, !Task.isCancelled else { return }
                self.error = error.localizedDescription
                let failedID = id
                id = nil
                authorizationURL = nil
                phase = .failed
                if let failedID { try? await client.cancelOpenRouterOAuth(id: failedID) }
            }
        }
    }

    func retryTest() {
        guard phase == .authorized else { return }
        let currentAttempt = attempt
        phase = .testing
        task = Task { await finish(currentAttempt: currentAttempt) }
    }

    func cancel() {
        // A model test may already be committing settings. Let it finish.
        guard !isTesting else { return }
        attempt = UUID()
        // Let an in-flight start return its id so we can delete the listener;
        // cancelling URLSession before that response would orphan it until expiry.
        if phase != .starting { task?.cancel() }
        task = nil
        let oldID = id
        id = nil
        phase = .idle
        authorizationURL = nil
        error = nil
        if let oldID { Task { try? await client.cancelOpenRouterOAuth(id: oldID) } }
    }

    private func finish(currentAttempt: UUID) async {
        guard let id, attempt == currentAttempt else { return }
        phase = .testing
        error = nil
        do {
            let response = try await client.finishOpenRouterOAuth(id: id)
            guard attempt == currentAttempt else { return }
            guard response.ok, response.details?.testResponse != nil else { throw TobyClientError.invalidResponse }
            result = response
            phase = .completed
            authorizationURL = nil
            self.id = nil
        } catch {
            guard attempt == currentAttempt else { return }
            self.error = error.localizedDescription
            // Keep the daemon session so credits/network issues can be retried
            // without creating another key. Expired sessions offer restart too.
            phase = .authorized
        }
    }
}
