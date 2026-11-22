import Foundation

/// Server settings for an address: provider presets, then the Thunderbird
/// ISPDB (port of the email plugin's `discover.ts`).
public enum MailDiscovery {
	public struct Settings: Sendable, Equatable, Codable {
		public var imapHost: String
		public var imapPort: String
		public var imapSecure: String
		public var imapUsername: String
		public var smtpHost: String
		public var smtpPort: String
		public var smtpSecure: String
		public var smtpUsername: String
		public var fromAddress: String
	}

	public struct Result: Sendable, Equatable {
		public var email: String
		public var domain: String
		public var source: String
		public var providerName: String?
		public var appPasswordRequired: Bool?
		public var documentationURL: String?
		public var settings: Settings
	}

	struct Preset {
		var name: String
		var domains: [String]
		var imap: (String, String, String)
		var smtp: (String, String, String)
		var docs: String
	}

	static let presets = [
		Preset(name: "Gmail", domains: ["gmail.com", "googlemail.com"], imap: ("imap.gmail.com", "993", "true"), smtp: ("smtp.gmail.com", "465", "true"), docs: "https://support.google.com/mail/answer/78892?hl=en&sjid=15691795537353814651-NA"),
		Preset(name: "Outlook", domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"], imap: ("outlook.office365.com", "993", "true"), smtp: ("smtp.office365.com", "587", "false"), docs: "https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com"),
		Preset(name: "iCloud", domains: ["icloud.com", "me.com", "mac.com"], imap: ("imap.mail.me.com", "993", "true"), smtp: ("smtp.mail.me.com", "587", "false"), docs: "https://support.apple.com/en-us/102525"),
		Preset(name: "Yahoo", domains: ["yahoo.com", "ymail.com", "rocketmail.com"], imap: ("imap.mail.yahoo.com", "993", "true"), smtp: ("smtp.mail.yahoo.com", "465", "true"), docs: "https://help.yahoo.com/kb/SLN4075.html"),
		Preset(name: "Fastmail", domains: ["fastmail.com", "fastmail.fm"], imap: ("imap.fastmail.com", "993", "true"), smtp: ("smtp.fastmail.com", "465", "true"), docs: "https://www.fastmail.help/hc/en-us/articles/1500000279921-IMAP-POP-and-SMTP"),
		Preset(name: "Proton Mail", domains: ["proton.me", "protonmail.com", "pm.me"], imap: ("127.0.0.1", "1143", "false"), smtp: ("127.0.0.1", "1025", "false"), docs: "https://proton.me/support/imap-smtp-and-pop3-setup"),
	]

	public static func isDNSDomain(_ domain: String) -> Bool {
		guard domain.count <= 253, !domain.contains("/"), !domain.contains("\\") else { return false }
		let labels = domain.split(separator: ".", omittingEmptySubsequences: false)
		return labels.count >= 2 && labels.allSatisfy { $0.count <= 63 && $0.wholeMatch(of: /(?i)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/) != nil }
	}

	public static func parseAddress(_ raw: String) -> (email: String, domain: String)? {
		let email = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !email.isEmpty, !email.contains(where: \.isWhitespace), let at = email.lastIndex(of: "@"), at != email.startIndex, email.firstIndex(of: "@") == at else { return nil }
		let domain = email[email.index(after: at)...].lowercased()
		return isDNSDomain(domain) ? (email, domain) : nil
	}

	public static func discover(_ raw: String, fetchISPDB: (@Sendable (String) async -> String?)? = nil) async -> Result? {
		guard let (email, domain) = parseAddress(raw) else { return nil }
		if let preset = presets.first(where: { $0.domains.contains(domain) }) {
			return Result(email: email, domain: domain, source: "preset", providerName: preset.name, appPasswordRequired: true, documentationURL: preset.docs, settings: Settings(
				imapHost: preset.imap.0, imapPort: preset.imap.1, imapSecure: preset.imap.2, imapUsername: email,
				smtpHost: preset.smtp.0, smtpPort: preset.smtp.1, smtpSecure: preset.smtp.2, smtpUsername: email, fromAddress: email,
			))
		}
		let xml = await (fetchISPDB ?? fetchMozillaISPDB)(domain)
		if let xml, let parsed = parseISPDB(xml, email: email) {
			return Result(email: email, domain: domain, source: "ispdb", providerName: parsed.provider, settings: parsed.settings)
		}
		return Result(email: email, domain: domain, source: "none", settings: Settings(
			imapHost: "", imapPort: "993", imapSecure: "true", imapUsername: email, smtpHost: "", smtpPort: "587", smtpSecure: "false", smtpUsername: email, fromAddress: email,
		))
	}

	@Sendable static func fetchMozillaISPDB(_ domain: String) async -> String? {
		guard isDNSDomain(domain), let encoded = domain.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
		      let url = URL(string: "https://autoconfig.thunderbird.net/v1.1/\(encoded)"), url.host == "autoconfig.thunderbird.net" else { return nil }
		var request = URLRequest(url: url)
		request.timeoutInterval = 8
		guard let (data, response) = try? await URLSession.shared.data(for: request), (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
		return String(data: data, encoding: .utf8)
	}

	static func block(_ xml: String, tag: String, type: String) -> String? {
		guard let regex = try? Regex("(?i)<\(tag)\\b[^>]*\\btype=[\"']\(type)[\"'][^>]*>([\\s\\S]*?)</\(tag)>"),
		      let match = xml.firstMatch(of: regex), let body = match.output[1].substring else { return nil }
		return String(body)
	}

	static func value(_ xml: String, _ tag: String) -> String {
		guard let regex = try? Regex("(?i)<\(tag)\\b[^>]*>([\\s\\S]*?)</\(tag)>"), let match = xml.firstMatch(of: regex),
		      let body = match.output[1].substring else { return "" }
		return body.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	public static func parseISPDB(_ xml: String, email: String) -> (provider: String?, settings: Settings)? {
		guard let imap = block(xml, tag: "incomingServer", type: "imap") else { return nil }
		let host = value(imap, "hostname")
		guard !host.isEmpty else { return nil }
		let smtp = block(xml, tag: "outgoingServer", type: "smtp")
		func directTLS(_ socket: String) -> Bool { ["SSL", "SSL/TLS"].contains(socket.trimmingCharacters(in: .whitespaces).uppercased()) }
		func username(_ template: String) -> String {
			let local = email[..<(email.lastIndex(of: "@") ?? email.endIndex)]
			let expanded = template.replacingOccurrences(of: "%EMAILADDRESS%", with: email).replacingOccurrences(of: "%EMAILLOCALPART%", with: local).trimmingCharacters(in: .whitespaces)
			return expanded.isEmpty ? email : expanded
		}
		let provider = value(xml, "displayName")
		return (provider.isEmpty ? nil : provider, Settings(
			imapHost: host, imapPort: value(imap, "port").isEmpty ? "993" : value(imap, "port"),
			imapSecure: directTLS(value(imap, "socketType")) ? "true" : "false", imapUsername: username(value(imap, "username")),
			smtpHost: smtp.map { value($0, "hostname") } ?? "", smtpPort: smtp.map { value($0, "port").isEmpty ? "587" : value($0, "port") } ?? "",
			smtpSecure: smtp.map { directTLS(value($0, "socketType")) ? "true" : "false" } ?? "false",
			smtpUsername: smtp.map { username(value($0, "username")) } ?? email, fromAddress: email,
		))
	}
}
