import Foundation
import Observation

@Observable @MainActor
final class AISetupStore {
    enum Step: Int, CaseIterable {
        case welcome, account, connect, ready
        var label: String { ["Welcome", "Account", "Connect", "Ready"][rawValue] }
        var title: String {
            ["Give Toby its AI connection", "Create your account", "Connect it to Toby", "Toby is ready"][rawValue]
        }
        var explanation: String {
            ["Toby uses an AI service to answer questions, write, and summarize. Let’s connect an account. Toby will choose the settings for you.",
             "One account gives Toby access to several AI models. You won’t need to choose a model to get started.",
             "An API key is a private code that lets Toby use your AI account. It isn’t your password.",
             "Your AI connection is working. Toby has selected a model to get you started."][rawValue]
        }
    }

    var step: Step = .welcome
    var providerId: String {
        didSet { defaults.set(providerId, forKey: providerProgressKey) }
    }
    var guide: AIProviderSetupGuide?
    var fields: [String: String] = [:]
    let oauth: AISetupOAuthSession
    var useManualKey = false
    var usesBrowserSignIn: Bool { providerId == "openrouter" && !useManualKey }
    var isBusy: Bool { isSubmitting || oauth.isTesting }
    var navigationLocked: Bool { isSubmitting || oauth.isActive }
    var isLoading = false
    var isSubmitting = false
    var error: String?
    var result: AIProviderSetupResponse?
    private let defaults: UserDefaults
    private let client = TobyClient()

    init(providerId: String = "openrouter", restoreProvider: Bool = true, oauth: AISetupOAuthSession? = nil, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.oauth = oauth ?? AISetupOAuthSession()
        self.providerId = restoreProvider ? (defaults.string(forKey: "aiSetup.provider.\(providerId)") ?? providerId) : providerId
        self.progressKey = "aiSetup.\(providerId)"
        if let saved = Step(rawValue: defaults.integer(forKey: progressKey)), saved != .ready {
            step = saved
        }
    }
    private let progressKey: String
    private var providerProgressKey: String { "aiSetup.provider.\(progressKey.dropFirst(8))" }
    var canSubmit: Bool {
        guard let guide, guide.providerId == providerId, !isSubmitting, !isLoading, !guide.fields.isEmpty else { return false }
        return guide.fields.filter { $0.required != false }.allSatisfy {
            !(fields[$0.key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
    func go(to next: Step) {
        guard !navigationLocked else { return }
        step = next
        error = nil
        defaults.set(next == .ready ? 0 : next.rawValue, forKey: progressKey)
        defaults.set(providerId, forKey: providerProgressKey)
    }
    func loadGuide() async {
        let requestedProvider = providerId
        isLoading = true
        error = nil
        guide = nil
        fields = [:]
        do {
            let loaded = try await client.fetchAIProviderSetupGuide(providerId: requestedProvider)
            guard !Task.isCancelled, providerId == requestedProvider else { return }
            guide = loaded
        } catch {
            guard !Task.isCancelled, providerId == requestedProvider else { return }
            self.error = "Toby couldn’t load the setup instructions. Check that the local server is running, then try again."
        }
        if providerId == requestedProvider { isLoading = false }
    }
    func acceptConnection(_ response: AIProviderSetupResponse) {
        result = response
        fields = [:]
        step = .ready
        defaults.removeObject(forKey: progressKey)
    }

    func submit() async -> Bool {
        guard canSubmit else { return false }
        isSubmitting = true
        error = nil
        defer { isSubmitting = false }
        do {
            let response = try await client.setupAIProvider(
                providerId: providerId,
                fields: fields.mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) },
                model: guide?.defaultModel
            )
            guard response.ok, response.details?.testResponse != nil else {
                error = "The server did not confirm a model response. Update or restart Toby’s server and try again."
                return false
            }
            acceptConnection(response)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}
