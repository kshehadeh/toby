import Foundation
import Observation

@Observable @MainActor
final class EmailSetupStore {
	enum Step: Int, CaseIterable {
		case welcome, account, servers, credentials, ready

		var label: String {
			["Welcome", "Account", "Servers", "Password", "Ready"][rawValue]
		}

		var title: String {
			[
				"Set up email",
				"Enter your email address",
				"Confirm your mail servers",
				"Add your password",
				"Email is connected",
			][rawValue]
		}

		var explanation: String {
			[
				"Toby can read and send mail over IMAP and SMTP. Start with your address and Toby will look up the server settings.",
				"Toby uses the part after @ to find your incoming and outgoing servers.",
				"These are the servers Toby will use. Change anything that doesn’t look right before continuing.",
				"Use an app password when your provider asks for one. Toby stores it with your other credentials on this Mac.",
				"Toby reached your mailbox. You can read and organize mail from chat.",
			][rawValue]
		}
	}

	var step: Step = .welcome
	var email = ""
	var settings = EmailDiscoverSettings(
		imapHost: "",
		imapPort: "993",
		imapSecure: "true",
		imapUsername: "",
		smtpHost: "",
		smtpPort: "587",
		smtpSecure: "false",
		smtpUsername: "",
		fromAddress: ""
	)
	var password = ""
	var smtpPassword = ""
	var useSeparateSmtpPassword = false
	var fromName = ""
	var providerName: String?
	var source: String?
	var appPasswordRequired = false
	var documentationUrl: String?
	var isDiscovering = false
	var isSubmitting = false
	var error: String?

	private let defaults: UserDefaults
	private let client: TobyClient
	private let stepKey = "emailSetup.step"
	private let emailKey = "emailSetup.email"

	var isBusy: Bool { isDiscovering || isSubmitting }
	var navigationLocked: Bool { isBusy }

	var canDiscover: Bool {
		!navigationLocked && Self.looksLikeEmail(email)
	}

	var canContinueFromServers: Bool {
		!trimmed(settings.imapHost).isEmpty && !trimmed(settings.imapUsername).isEmpty
	}

	var canConnect: Bool {
		guard canContinueFromServers, !trimmed(password).isEmpty else { return false }
		if useSeparateSmtpPassword && !trimmed(settings.smtpHost).isEmpty {
			return !trimmed(smtpPassword).isEmpty
		}
		return true
	}

	var serverSummary: String {
		switch source {
		case "preset":
			if let providerName {
				return "Found \(providerName) settings for this address."
			}
			return "Found settings for this address."
		case "ispdb":
			return "Found server settings published for this email domain."
		default:
			return "Toby couldn’t find server settings for this address. Enter them below."
		}
	}

	init(
		initialEmail: String? = nil,
		client: TobyClient = TobyClient(),
		defaults: UserDefaults = .standard
	) {
		self.client = client
		self.defaults = defaults
		let hasProgress = defaults.object(forKey: stepKey) != nil
		if hasProgress, let saved = Step(rawValue: defaults.integer(forKey: stepKey)), saved != .ready {
			step = saved
		}
		if let savedEmail = defaults.string(forKey: emailKey), !savedEmail.isEmpty {
			email = savedEmail
		} else if let initialEmail, Self.looksLikeEmail(initialEmail) {
			email = initialEmail.trimmingCharacters(in: .whitespacesAndNewlines)
			if !hasProgress {
				step = .account
			}
		}
	}

	func go(to next: Step) {
		guard !navigationLocked else { return }
		step = next
		error = nil
		persistProgress()
	}

	func discover() async -> Bool {
		let address = trimmed(email)
		guard Self.looksLikeEmail(address), !navigationLocked else { return false }
		isDiscovering = true
		error = nil
		defer { isDiscovering = false }
		do {
			let response = try await client.discoverIntegrationSettings(name: "email", email: address)
			guard response.ok else {
				error = "Toby couldn’t look up settings for that address."
				return false
			}
			email = response.email
			settings = response.settings
			source = response.source
			providerName = response.providerName
			appPasswordRequired = response.appPasswordRequired == true
			documentationUrl = response.documentationUrl
			step = .servers
			persistProgress()
			return true
		} catch {
			self.error = error.localizedDescription
			return false
		}
	}

	func connect() async -> Bool {
		guard canConnect else { return false }
		isSubmitting = true
		error = nil
		defer { isSubmitting = false }
		let outgoingPassword = useSeparateSmtpPassword ? trimmed(smtpPassword) : trimmed(password)
		var changes: [String: String] = [
			"email.imapHost": trimmed(settings.imapHost),
			"email.imapPort": trimmed(settings.imapPort),
			"email.imapSecure": trimmed(settings.imapSecure),
			"email.imapUsername": trimmed(settings.imapUsername),
			"email.imapPassword": trimmed(password),
			"email.fromAddress": trimmed(settings.fromAddress),
		]
		if !trimmed(settings.smtpHost).isEmpty {
			changes["email.smtpHost"] = trimmed(settings.smtpHost)
			changes["email.smtpPort"] = trimmed(settings.smtpPort)
			changes["email.smtpSecure"] = trimmed(settings.smtpSecure)
			changes["email.smtpUsername"] = trimmed(settings.smtpUsername)
			changes["email.smtpPassword"] = outgoingPassword
		}
		if !trimmed(fromName).isEmpty {
			changes["email.fromName"] = trimmed(fromName)
		}
		do {
			_ = try await client.patchConfigure(changes: changes)
			let response = try await client.runIntegrationAction(name: "email", action: .connect)
			guard response.ok else {
				error = response.error ?? "Toby couldn’t connect to this mailbox."
				return false
			}
			password = ""
			smtpPassword = ""
			step = .ready
			defaults.removeObject(forKey: stepKey)
			defaults.removeObject(forKey: emailKey)
			return true
		} catch {
			self.error = error.localizedDescription
			return false
		}
	}

	private func persistProgress() {
		defaults.set(step == .ready ? 0 : step.rawValue, forKey: stepKey)
		defaults.set(trimmed(email), forKey: emailKey)
	}

	private func trimmed(_ value: String) -> String {
		value.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	static func looksLikeEmail(_ value: String) -> Bool {
		let address = value.trimmingCharacters(in: .whitespacesAndNewlines)
		guard let at = address.lastIndex(of: "@"), at != address.startIndex, at != address.index(before: address.endIndex) else {
			return false
		}
		let domain = address[address.index(after: at)...]
		return domain.contains(".") && !address.contains(" ")
	}
}
