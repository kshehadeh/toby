import Foundation
import Testing
@testable import TobyApp

private final class MockSignInHandle: OpenRouterSignInHandle, @unchecked Sendable {
    let authorizationURL: URL
    private let lock = NSLock()
    private var continuation: CheckedContinuation<String, Error>?
    private var outcome: Result<String, Error>?
    private(set) var cancelled = false

    init(url: String) { authorizationURL = URL(string: url)! }

    func waitForKey(timeout: Duration) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            if let outcome {
                lock.unlock()
                continuation.resume(with: outcome)
            } else {
                self.continuation = continuation
                lock.unlock()
            }
        }
    }

    func complete(_ result: Result<String, Error>) {
        lock.lock()
        outcome = result
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(with: result)
    }

    var isWaiting: Bool { lock.withLock { continuation != nil } }

    func cancel() {
        lock.withLock { cancelled = true }
        complete(.failure(CancellationError()))
    }
}

@MainActor private final class MockSetupOAuthClient: AISetupOAuthClient {
    var begins = 0
    var connects: [String] = []
    var failFirstTest = false
    var delayBegin = false
    var beginContinuation: CheckedContinuation<any OpenRouterSignInHandle, Error>?
    var authorizationURL = "https://openrouter.ai/auth?code_challenge=test"
    var handles: [MockSignInHandle] = []

    func makeHandle() -> MockSignInHandle {
        let handle = MockSignInHandle(url: authorizationURL)
        handles.append(handle)
        return handle
    }

    func beginOpenRouterSignIn() async throws -> any OpenRouterSignInHandle {
        begins += 1
        if delayBegin { return try await withCheckedThrowingContinuation { beginContinuation = $0 } }
        return makeHandle()
    }

    func connectOpenRouter(apiKey: String) async throws -> AIProviderSetupResponse {
        connects.append(apiKey)
        if failFirstTest && connects.count == 1 { throw TobyClientError.serverError("Add credits and retry.") }
        return try JSONDecoder().decode(AIProviderSetupResponse.self, from: Data(#"{"ok":true,"providerId":"openrouter","configured":true,"details":{"testResponse":"Ready"}}"#.utf8))
    }
}

@MainActor struct AISetupOAuthSessionTests {
    private func waitFor(_ condition: () -> Bool) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        #expect(condition())
    }

    @Test("browser approval tests the connection once and delivers readiness")
    func completes() async throws {
        let client = MockSetupOAuthClient()
        let session = AISetupOAuthSession(client: client)
        var opened: URL?
        session.start { opened = $0; return true }
        try await waitFor { session.phase == .waiting }
        client.handles[0].complete(.success("sk-or-key"))
        try await waitFor { session.phase == .completed }
        #expect(opened?.host == "openrouter.ai")
        #expect(client.connects == ["sk-or-key"])
        #expect(session.result?.details?.testResponse == "Ready")
        #expect(session.authorizationURL == nil)
    }

    @Test("credit errors retry the same key instead of signing in again")
    func retries() async throws {
        let client = MockSetupOAuthClient()
        client.failFirstTest = true
        let session = AISetupOAuthSession(client: client)
        session.start { _ in true }
        try await waitFor { session.phase == .waiting }
        client.handles[0].complete(.success("sk-or-key"))
        try await waitFor { session.phase == .authorized && session.error != nil }
        #expect(session.error == "Add credits and retry.")
        session.retryTest()
        session.retryTest()
        try await waitFor { session.phase == .completed }
        #expect(client.begins == 1)
        #expect(client.connects == ["sk-or-key", "sk-or-key"])
    }

    @Test("cancelling while start is in flight releases the late listener")
    func cancelsLateStart() async throws {
        let client = MockSetupOAuthClient()
        client.delayBegin = true
        let session = AISetupOAuthSession(client: client)
        var opened = false
        session.start { _ in opened = true; return true }
        try await waitFor { client.beginContinuation != nil }
        session.cancel()
        let late = client.makeHandle()
        client.beginContinuation?.resume(returning: late)
        try await waitFor { late.cancelled }
        #expect(!opened)
        #expect(client.connects.isEmpty)
        #expect(session.phase == .idle)
    }

    @Test("waiting sessions can be cancelled without testing or saving")
    func cancelsWaiting() async throws {
        let client = MockSetupOAuthClient()
        let session = AISetupOAuthSession(client: client)
        session.start { _ in true }
        try await waitFor { session.phase == .waiting }
        session.cancel()
        #expect(client.handles[0].cancelled)
        #expect(client.connects.isEmpty)
        #expect(session.authorizationURL == nil)
        #expect(session.phase == .idle)
    }

    @Test("a failed or expired sign-in returns a readable failure")
    func expires() async throws {
        let client = MockSetupOAuthClient()
        let session = AISetupOAuthSession(client: client)
        session.start { _ in true }
        try await waitFor { session.phase == .waiting }
        client.handles[0].complete(.failure(TobyClientError.serverError("Sign-in expired.")))
        try await waitFor { session.phase == .failed }
        #expect(session.error == "Sign-in expired.")
        #expect(client.connects.isEmpty)
    }

    @Test("untrusted browser destinations are never opened")
    func rejectsUntrustedURL() async throws {
        let client = MockSetupOAuthClient()
        client.authorizationURL = "https://example.com/auth"
        let session = AISetupOAuthSession(client: client)
        var opened = false
        session.start { _ in opened = true; return true }
        try await waitFor { session.phase == .failed }
        #expect(!opened)
        #expect(client.handles[0].cancelled)
    }
}
