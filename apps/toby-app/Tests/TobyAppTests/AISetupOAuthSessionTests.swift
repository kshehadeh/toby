import Foundation
import Testing
@testable import TobyApp

@MainActor private final class MockSetupOAuthClient: AISetupOAuthClient {
    var starts = 0
    var finishes = 0
    var cancels: [String] = []
    var status = "authorized"
    var failFirstTest = false
    var delayStart = false
    var startContinuation: CheckedContinuation<AIProviderOAuthStatus, Error>?
    var authorizationURL = "https://openrouter.ai/auth?code_challenge=test"

    func snapshot() -> AIProviderOAuthStatus {
        AIProviderOAuthStatus(id: "session", state: status, authorizationUrl: authorizationURL, expiresAt: 9999999999999, error: status == "error" ? "Sign-in expired." : nil)
    }
    func startOpenRouterOAuth() async throws -> AIProviderOAuthStatus {
        starts += 1
        if delayStart { return try await withCheckedThrowingContinuation { startContinuation = $0 } }
        return snapshot()
    }
    func fetchOpenRouterOAuth(id: String) async throws -> AIProviderOAuthStatus { snapshot() }
    func finishOpenRouterOAuth(id: String) async throws -> AIProviderSetupResponse {
        finishes += 1
        if failFirstTest && finishes == 1 { throw TobyClientError.serverError("Add credits and retry.") }
        return try JSONDecoder().decode(AIProviderSetupResponse.self, from: Data(#"{"ok":true,"providerId":"openrouter","configured":true,"details":{"testResponse":"Ready"}}"#.utf8))
    }
    func cancelOpenRouterOAuth(id: String) async throws { cancels.append(id) }
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
        let session = AISetupOAuthSession(client: client, pollInterval: .milliseconds(5))
        var opened: URL?
        session.start { opened = $0; return true }
        try await waitFor { session.phase == .completed }
        #expect(opened?.host == "openrouter.ai")
        #expect(client.finishes == 1)
        #expect(session.result?.details?.testResponse == "Ready")
        #expect(session.authorizationURL == nil)
    }

    @Test("credit errors retry the same authorization instead of signing in again")
    func retries() async throws {
        let client = MockSetupOAuthClient()
        client.failFirstTest = true
        let session = AISetupOAuthSession(client: client)
        session.start { _ in true }
        try await waitFor { session.phase == .authorized }
        #expect(session.error == "Add credits and retry.")
        session.retryTest()
        session.retryTest()
        try await waitFor { session.phase == .completed }
        #expect(client.starts == 1)
        #expect(client.finishes == 2)
    }

    @Test("cancelling while start is in flight cleans up the late server session")
    func cancelsLateStart() async throws {
        let client = MockSetupOAuthClient()
        client.delayStart = true
        let session = AISetupOAuthSession(client: client)
        var opened = false
        session.start { _ in opened = true; return true }
        try await waitFor { client.startContinuation != nil }
        session.cancel()
        client.startContinuation?.resume(returning: client.snapshot())
        try await waitFor { client.cancels.count == 1 }
        #expect(!opened)
        #expect(client.finishes == 0)
        #expect(session.phase == .idle)
    }

    @Test("waiting sessions can be cancelled without testing or saving")
    func cancelsWaiting() async throws {
        let client = MockSetupOAuthClient()
        client.status = "waiting"
        let session = AISetupOAuthSession(client: client, pollInterval: .milliseconds(5))
        session.start { _ in true }
        try await waitFor { session.phase == .waiting }
        session.cancel()
        try await waitFor { client.cancels.count == 1 }
        #expect(client.finishes == 0)
        #expect(session.authorizationURL == nil)
        #expect(session.phase == .idle)
    }

    @Test("expired authorization returns a readable failure and releases the session")
    func expires() async throws {
        let client = MockSetupOAuthClient()
        client.status = "error"
        let session = AISetupOAuthSession(client: client)
        session.start { _ in true }
        try await waitFor { session.phase == .failed }
        #expect(session.error == "Sign-in expired.")
        #expect(client.finishes == 0)
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
        #expect(client.cancels == ["session"])
    }
}
