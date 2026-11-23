import Foundation

/// Settings section keys used for deep links (see `NativeSettingsSection`).
enum SettingsItem {
	static let appearanceSectionKey = "appearance"
	static let personasSectionKey = "personas"
	static let personasCatalogSubtitle = "Create and edit how Toby thinks and which model it uses."
	static let iCloudSectionKey = "icloud"
	/// Mail and Slack (formerly "Integrations").
	static let integrationsSectionKey = "sources"
	static let followupsSectionKey = "followups"
	/// OpenRouter account and chat model.
	static let aiSectionKey = "account"
}

/// Result of a persona or skill edit (`NativeConfigureActions`).
struct ConfigureActionResponse: Decodable {
	let ok: Bool
	let personaName: String?
	let scheduleId: String?
	let runId: String?
	let dirName: String?
}

struct EmailDiscoverSettings: Decodable {
	var imapHost: String
	var imapPort: String
	var imapSecure: String
	var imapUsername: String
	var smtpHost: String
	var smtpPort: String
	var smtpSecure: String
	var smtpUsername: String
	var fromAddress: String
}

struct EmailDiscoverResponse: Decodable {
	let ok: Bool
	let email: String
	let domain: String
	let source: String
	let providerName: String?
	let appPasswordRequired: Bool?
	let documentationUrl: String?
	let settings: EmailDiscoverSettings
}
struct SettingsSelectChoice: Decodable, Equatable {
	let value: String
	let label: String
}

