import Foundation
import Observation

@Observable @MainActor
final class SlackSetupStore {
    enum Step: Int, CaseIterable {
        case welcome, app, bot, socket, search, verify, ready
        var title: String {
            ["Connect Slack to Toby", "Create your Slack app", "Install Toby in Slack", "Connect inbound chat", "Add message search", "Try a message in Slack", "Slack setup complete"][rawValue]
        }
        var explanation: String {
            ["Send messages from Toby and optionally receive DMs and @mentions. Your workspace may require approval to install an app.",
             "Toby provides the scopes, events, and Socket Mode settings. Choose your workspace and review the app in Slack.",
             "Install the app into your workspace, then copy its Bot User OAuth Token. Toby will check the workspace and permissions.",
             "An app-level token lets this Mac listen for messages through Socket Mode. It is separate from the bot token.",
             "User authorization adds workspace message search. The bot connection works without it.",
             "Enable inbound, then send a DM to Toby or invite it to a channel and @mention it. Toby checks for a received message and a delivered reply.",
             "Your verified credentials are saved on this Mac. You can return to setup to finish or repair inbound chat."][rawValue]
        }
    }
    var step: Step = .welcome
    var inbound = true
    var existingApp = false
    var botToken = ""
    var appToken = ""
    var clientId = ""
    var persona = ""
    var personas: [PersonaOption] = []
    var configuredFields: Set<String> = []
    var teamName: String?
    var activeIntegration: String?
    var guide: IntegrationSetupGuide?
    var isLoading = false
    var isSubmitting = false
    var error: String?
    var inboundStatus: ChatInboundStatus?
    var testStartedAt: Date?
    var testVerified = false
    var monitoringTimedOut = false
    var monitoringGeneration = 0
    var monitoringID: String { "\(step.rawValue)-\(testStartedAt?.timeIntervalSince1970 ?? 0)-\(monitoringGeneration)" }
    var toolsValidated = false
    private let client: TobyClient
    private let defaults: UserDefaults
    private var operation: Task<Void, Never>?
    private let stepKey = "slackSetup.step"
    var isBusy: Bool { isLoading || isSubmitting }
    var hasBot: Bool { !trimmed(botToken).isEmpty || configuredFields.contains("botToken") || configuredFields.contains("oauthBotToken") }
    var hasAppToken: Bool { !trimmed(appToken).isEmpty || configuredFields.contains("appToken") }
    var canValidateBot: Bool { hasBot && (!inbound || hasAppToken) && !isBusy }
    var canAuthorize: Bool { !trimmed(clientId).isEmpty && !isBusy }
    var hasUserTools: Bool { configuredFields.contains("oauthUserToken") }
    var creationURL: URL? { guide?.steps?.first(where: { $0.id == "app" })?.links?.first.flatMap { URL(string: $0.url) } }
    var manifest: String? { guide?.steps?.first(where: { $0.id == "app" })?.artifacts?.first?.value }
    var redirectURI: String { guide?.steps?.first(where: { $0.id == "oauth" })?.artifacts?.first?.value ?? "http://localhost:9878/callback" }

    init(client: TobyClient = TobyClient(), defaults: UserDefaults = .standard) {
        self.client = client
        self.defaults = defaults
        if let saved = Step(rawValue: defaults.integer(forKey: stepKey)), saved != .ready { step = saved }
        if defaults.object(forKey: "slackSetup.inbound") != nil { inbound = defaults.bool(forKey: "slackSetup.inbound") }
        existingApp = defaults.bool(forKey: "slackSetup.existingApp")
    }

    func go(to next: Step) {
        guard !isBusy else { return }
        step = next
        error = nil
        defaults.set(next == .ready ? 0 : next.rawValue, forKey: stepKey)
        defaults.set(inbound, forKey: "slackSetup.inbound")
        defaults.set(existingApp, forKey: "slackSetup.existingApp")
    }

    func load() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            guide = try await client.fetchIntegrationSetupGuide(name: "slack")
            let state = try await client.fetchIntegrationSetupState(name: "slack")
            configuredFields = Set(state.configuredFields)
            teamName = state.teamName
            activeIntegration = state.activeIntegration
            persona = state.persona
            personas = try await client.listPersonas()
            // Never resume past validation merely because a local step was saved.
            if step.rawValue >= Step.search.rawValue { step = .bot }
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }

    func connectBot() {
        guard canValidateBot else { return }
        perform {
            var fields: [String: String] = [:]
            if !self.trimmed(self.botToken).isEmpty { fields["botToken"] = self.trimmed(self.botToken) }
            if self.inbound && !self.trimmed(self.appToken).isEmpty { fields["appToken"] = self.trimmed(self.appToken) }
            let result = try await self.client.connectIntegrationSetup(name: "slack", fields: fields, stage: "bot", inbound: self.inbound)
            try Task.checkCancellation()
            guard result.ok else { throw TobyClientError.serverError("Slack did not confirm the credentials.") }
            self.teamName = result.details.teamName
            self.toolsValidated = true
            self.configuredFields.insert("botToken")
            if self.inbound { self.configuredFields.insert("appToken") }
            self.botToken = ""
            self.appToken = ""
            self.step = .search
            self.defaults.set(Step.search.rawValue, forKey: self.stepKey)
        }
    }

    func authorizeSearch() {
        guard canAuthorize else { return }
        perform {
            let result = try await self.client.connectIntegrationSetup(name: "slack", fields: ["clientId": self.trimmed(self.clientId)], stage: "oauth", inbound: self.inbound)
            try Task.checkCancellation()
            guard result.ok else { throw TobyClientError.serverError("Slack did not confirm user authorization.") }
            self.configuredFields.insert("oauthUserToken")
            self.clientId = ""
            self.step = self.inbound ? .verify : .ready
        }
    }

    func enableInbound() {
        guard toolsValidated, inbound, !isBusy else { return }
        perform {
            var changes = ["chatInbound.enabled": "true", "chatInbound.integration": "slack", "slack.inboundEnabled": "true"]
            changes["chatInbound.persona"] = self.persona
            _ = try await self.client.patchConfigure(changes: changes)
            self.testStartedAt = Date()
            self.testVerified = false
            self.monitoringTimedOut = false
            self.activeIntegration = "slack"
            self.inboundStatus = nil
        }
    }

    func refreshInbound() async {
        guard inbound, step == .verify, testStartedAt != nil else { return }
        do {
            let status = try await client.fetchDaemonStatus().chatInbound
            guard !Task.isCancelled else { return }
            acceptInboundStatus(status)
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }

    func acceptInboundStatus(_ status: ChatInboundStatus?) {
            inboundStatus = status
            if status?.integration == "slack", let started = testStartedAt,
               let eventAt = Self.parseDate(status?.lastEventAt), eventAt >= started,
               let replyAt = Self.parseDate(status?.lastReplyAt), replyAt >= eventAt,
               status?.isConnected == true,
               status?.lastEventExternalKey != nil, status?.lastEventExternalKey == status?.lastReplyExternalKey { testVerified = true }
    }

    func resumeMonitoring() {
        monitoringTimedOut = false
        monitoringGeneration += 1
    }

    func cancel() {
        if isSubmitting { Task { await client.cancelIntegrationSetup(name: "slack") } }
        operation?.cancel()
        operation = nil
        botToken = ""
        appToken = ""
        clientId = ""
    }

    private func perform(_ action: @escaping @MainActor () async throws -> Void) {
        isSubmitting = true
        error = nil
        operation = Task {
            defer { isSubmitting = false; operation = nil }
            do { try await action() }
            catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
    private func trimmed(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
    private static func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return parser.date(from: value)
    }
}
