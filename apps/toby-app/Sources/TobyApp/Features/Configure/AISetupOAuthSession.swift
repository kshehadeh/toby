import Foundation
import Observation
import TobyAI

/// One in-flight browser sign-in (implemented by `TobyAI.OpenRouterSignIn`).
protocol OpenRouterSignInHandle: AnyObject, Sendable {
    var authorizationURL: URL { get }
    func waitForKey(timeout: Duration) async throws -> String
    func cancel()
}

extension OpenRouterSignIn: OpenRouterSignInHandle {}

@MainActor protocol AISetupOAuthClient {
    /// Bind the loopback callback and build the OpenRouter authorization URL.
    func beginOpenRouterSignIn() async throws -> any OpenRouterSignInHandle
    /// Store the key in the Keychain and confirm a model answers.
    func connectOpenRouter(apiKey: String) async throws -> AIProviderSetupResponse
}

/// Default client: native PKCE in-process; the key goes to the Keychain.
///
/// Migration bridge (until chat runs in Swift): the key is also handed to the
/// daemon's provider setup so its chat pipeline keeps working, and that call
/// performs the readiness test the UI shows.
@MainActor struct NativeOpenRouterConnector: AISetupOAuthClient {
    var keyStore = KeychainKeyStore()
    var daemon = TobyClient()

    func beginOpenRouterSignIn() async throws -> any OpenRouterSignInHandle {
        try await OpenRouterSignIn.start()
    }

    func connectOpenRouter(apiKey: String) async throws -> AIProviderSetupResponse {
        try keyStore.save(apiKey)
        return try await daemon.setupAIProvider(providerId: "openrouter", fields: ["apiKey": apiKey])
    }
}

/// Owns the browser handshake. The authorization code and key never leave the app.
@Observable @MainActor
final class AISetupOAuthSession {
    enum Phase { case idle, starting, waiting, exchanging, authorized, testing, completed, failed }
    private(set) var phase: Phase = .idle
    private(set) var authorizationURL: URL?
    private(set) var error: String?
    private(set) var result: AIProviderSetupResponse?
    private var handle: (any OpenRouterSignInHandle)?
    /// Held only between sign-in and a successful connection test, so a credits
    /// failure can be retried without creating another key.
    private var pendingKey: String?
    private var attempt = UUID()
    private var task: Task<Void, Never>?
    private let client: any AISetupOAuthClient
    private let signInTimeout: Duration

    init(client: (any AISetupOAuthClient)? = nil, signInTimeout: Duration = .seconds(600)) {
        self.client = client ?? NativeOpenRouterConnector()
        self.signInTimeout = signInTimeout
    }
    var isActive: Bool { [.starting, .waiting, .exchanging, .authorized, .testing].contains(phase) }
    var isTesting: Bool { phase == .testing }

    func start(openBrowser: @escaping (URL) -> Bool) {
        guard !isActive else { return }
        error = nil
        result = nil
        pendingKey = nil
        phase = .starting
        let currentAttempt = UUID()
        attempt = currentAttempt
        task = Task {
            do {
                let handle = try await client.beginOpenRouterSignIn()
                guard attempt == currentAttempt, !Task.isCancelled else {
                    handle.cancel()
                    return
                }
                self.handle = handle
                let url = handle.authorizationURL
                guard url.scheme == "https", url.host == "openrouter.ai", url.path == "/auth" else {
                    throw TobyClientError.invalidResponse
                }
                authorizationURL = url
                guard openBrowser(url) else {
                    throw TobyClientError.serverError("Toby couldn’t open your browser. Try connecting again.")
                }
                phase = .waiting
                let key = try await handle.waitForKey(timeout: signInTimeout)
                guard attempt == currentAttempt, !Task.isCancelled else { return }
                self.handle = nil
                pendingKey = key
                phase = .authorized
                await finish(currentAttempt: currentAttempt)
            } catch {
                guard attempt == currentAttempt, !Task.isCancelled else { return }
                self.error = error.localizedDescription
                handle?.cancel()
                handle = nil
                authorizationURL = nil
                phase = .failed
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
        // A connection test may already be committing settings. Let it finish.
        guard !isTesting else { return }
        attempt = UUID()
        if phase != .starting { task?.cancel() }
        task = nil
        handle?.cancel()
        handle = nil
        pendingKey = nil
        phase = .idle
        authorizationURL = nil
        error = nil
    }

    private func finish(currentAttempt: UUID) async {
        guard let key = pendingKey, attempt == currentAttempt else { return }
        phase = .testing
        error = nil
        do {
            let response = try await client.connectOpenRouter(apiKey: key)
            guard attempt == currentAttempt else { return }
            guard response.ok, response.details?.testResponse != nil else { throw TobyClientError.invalidResponse }
            result = response
            phase = .completed
            authorizationURL = nil
            pendingKey = nil
        } catch {
            guard attempt == currentAttempt else { return }
            self.error = error.localizedDescription
            phase = .authorized
        }
    }
}
