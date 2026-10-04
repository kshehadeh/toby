import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
struct SlackSetupWizardViewTests {
    private func withStore(_ run: (SlackSetupStore, UserDefaults) throws -> Void) rethrows {
        let suite = "SlackSetupTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        try run(SlackSetupStore(defaults: defaults), defaults)
    }

    @Test("welcome offers inbound chat and explains separate credentials")
    func welcome() throws {
        try withStore { store, _ in
            let root = try SlackSetupWizardView(store: store, onDismiss: {}).inspect()
                .find(viewWithAccessibilityIdentifier: "slack-setup-wizard")
            _ = try root.find(text: "Connect Slack to Toby")
            _ = try root.find(text: "Get started")
            #expect(store.inbound)
        }
    }

    @Test("tools-only setup does not require an app-level token")
    func requirements() {
        withStore { store, _ in
            store.botToken = "xoxb-private"
            #expect(!store.canValidateBot)
            store.inbound = false
            #expect(store.canValidateBot)
            store.inbound = true
            store.configuredFields = ["appToken"]
            #expect(store.canValidateBot)
        }
    }

    @Test("resume keeps preferences and step, but never credentials")
    func resume() {
        withStore { store, defaults in
            store.botToken = "xoxb-secret"
            store.appToken = "xapp-secret"
            store.clientId = "private-client"
            store.inbound = false
            store.existingApp = true
            store.go(to: .bot)
            let resumed = SlackSetupStore(defaults: defaults)
            #expect(resumed.step == .bot)
            #expect(!resumed.inbound)
            #expect(resumed.existingApp)
            #expect(resumed.botToken.isEmpty)
            #expect(resumed.appToken.isEmpty)
            #expect(resumed.clientId.isEmpty)
        }
    }

    @Test("transport connection alone and replies from another conversation do not verify messages")
    func verification() throws {
        try withStore { store, _ in
            store.testStartedAt = Date(timeIntervalSince1970: 0)
            func status(_ event: String?, _ reply: String?, _ key: String?) throws -> ChatInboundStatus {
                let data = try JSONSerialization.data(withJSONObject: [
                    "enabled": true, "integration": "slack", "status": "connected",
                    "lastEventAt": event as Any? ?? NSNull(), "lastReplyAt": reply as Any? ?? NSNull(),
                    "lastEventExternalKey": "slack:test", "lastReplyExternalKey": key as Any? ?? NSNull()
                ])
                return try JSONDecoder().decode(ChatInboundStatus.self, from: data)
            }
            store.acceptInboundStatus(try status(nil, nil, nil))
            #expect(!store.testVerified)
            store.acceptInboundStatus(try status("2026-10-04T10:00:00.000Z", "2026-10-04T10:00:01.000Z", "other"))
            #expect(!store.testVerified)
            store.acceptInboundStatus(try status("2026-10-04T10:00:00.000Z", "2026-10-04T10:00:01.000Z", "slack:test"))
            #expect(store.testVerified)
        }
    }

    @Test("submission prevents changing steps")
    func navigation() {
        withStore { store, _ in
            store.go(to: .socket)
            store.isSubmitting = true
            store.go(to: .welcome)
            #expect(store.step == .socket)
        }
    }
}
