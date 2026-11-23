import AppKit
import SwiftUI
import TobyAI

/// OpenRouter account: sign-in state, credits, and the chat model override.
@Observable @MainActor
final class AccountSettingsModel {
	enum Phase: Equatable { case idle, waitingForBrowser, failed(String) }

	static let chatModelKey = "toby.ai.chatModel"

	private(set) var signedIn = false
	private(set) var phase: Phase = .idle
	private(set) var remainingCredits: Double?
	private(set) var models: [ModelInfo] = []
	private(set) var loadingModels = false
	var chatModel: String {
		didSet { UserDefaults.standard.set(chatModel.isEmpty ? nil : chatModel, forKey: Self.chatModelKey) }
	}

	private let keyStore: KeychainKeyStore
	private var signIn: OpenRouterSignIn?

	init(keyStore: KeychainKeyStore = KeychainKeyStore()) {
		self.keyStore = keyStore
		chatModel = UserDefaults.standard.string(forKey: Self.chatModelKey) ?? ""
	}

	func refresh() async {
		signedIn = ((try? keyStore.read()) ?? nil)?.isEmpty == false
		guard signedIn else { remainingCredits = nil; return }
		let ai = NativeRuntime.shared.ai
		if let credits = try? await ai.credits() { remainingCredits = credits.totalCredits - credits.totalUsage }
		if models.isEmpty {
			loadingModels = true
			defer { loadingModels = false }
			models = ((try? await ModelCatalog(client: ai).models(for: .chat)) ?? []).sorted { $0.name < $1.name }
		}
	}

	func beginSignIn() async {
		phase = .waitingForBrowser
		do {
			let session = try await OpenRouterSignIn.start()
			signIn = session
			NSWorkspace.shared.open(session.authorizationURL)
			let key = try await session.waitForKey()
			try keyStore.save(key)
			signIn = nil
			phase = .idle
			await refresh()
		} catch is CancellationError {
			phase = .idle
		} catch {
			signIn = nil
			phase = (error as? AIError) == .cancelled ? .idle : .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
		}
	}

	func cancelSignIn() {
		signIn?.cancel()
		signIn = nil
		phase = .idle
	}

	func signOut() {
		try? keyStore.delete()
		signedIn = false
		remainingCredits = nil
	}
}

struct AccountSettingsPane: View {
	@State private var model = AccountSettingsModel()

	var body: some View {
		SwiftUI.Form {
			Section {
				if model.signedIn {
					LabeledContent("OpenRouter") {
						Label("Signed in", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
					}
					if let credits = model.remainingCredits {
						LabeledContent("Credits remaining", value: credits.formatted(.currency(code: "USD")))
					}
					HStack {
						Button("Add Credits…") { NSWorkspace.shared.open(URL(string: "https://openrouter.ai/settings/credits")!) }
						Spacer()
						Button("Sign Out", role: .destructive) { model.signOut() }
							.accessibilityIdentifier("account-sign-out")
					}
				} else {
					Text("Toby uses OpenRouter for AI. Sign in to create a key for Toby; you pay OpenRouter directly for what you use.")
						.foregroundStyle(.secondary)
					switch model.phase {
					case .waitingForBrowser:
						HStack {
							ProgressView().controlSize(.small)
							Text("Finish signing in in your browser…")
							Spacer()
							Button("Cancel") { model.cancelSignIn() }
						}
					case let .failed(message):
						Text(message).foregroundStyle(.red)
						signInButton
					case .idle:
						signInButton
					}
				}
			} header: {
				Text("Account")
			}

			if model.signedIn {
				Section {
					Picker("Chat model", selection: $model.chatModel) {
						Text("Recommended (\(ModelRole.chat.defaultModelId))").tag("")
						if !model.chatModel.isEmpty, !model.models.contains(where: { $0.id == model.chatModel }) {
							Text(model.chatModel).tag(model.chatModel)
						}
						ForEach(model.models) { info in Text(info.name).tag(info.id) }
					}
					.accessibilityIdentifier("account-chat-model")
					if model.loadingModels { ProgressView().controlSize(.small) }
				} header: {
					Text("Advanced")
				} footer: {
					Text("Overrides the model for chats. Background work (Feed, follow-ups, titles) keeps Toby's tuned defaults.")
				}
			}
		}
		.tobySettingsFormStyle()
		.task { await model.refresh() }
	}

	private var signInButton: some View {
		Button("Sign in with OpenRouter") { Task { await model.beginSignIn() } }
			.buttonStyle(.borderedProminent)
			.accessibilityIdentifier("account-sign-in")
	}
}
