import Foundation

/// Persistent notice that a credit-based AI gateway cannot pay for a request.
struct GatewayFundsNotice: Equatable {
	static let code = "gateway_funds_exhausted"

	let providerId: String
	let activity: String

	var providerName: String {
		switch providerId {
		case "vercel": "Vercel AI Gateway"
		case "openrouter": "OpenRouter"
		default: providerId
		}
	}

	var title: String { "\(providerName) is out of funds" }
	var message: String { "Toby couldn't \(activity)." }
	/// Short sentence used on the surface that failed.
	var detailMessage: String { "\(providerName) is out of funds." }
	var settingsNavKey: String { "ai.\(providerId)" }

	init(providerId: String, activity: String) {
		self.providerId = providerId
		self.activity = activity
	}

	/// Decode the daemon payload (`code`, `providerId`, `activity`).
	init?(json: [String: Any]) {
		guard
			json["code"] as? String == Self.code,
			let providerId = json["providerId"] as? String,
			providerId == "vercel" || providerId == "openrouter",
			let activity = json["activity"] as? String,
			!activity.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
		else { return nil }
		self.init(providerId: providerId, activity: activity)
	}

	/// Library indexing stores only the short sentence on the item.
	init?(libraryError message: String) {
		switch message {
		case "Vercel AI Gateway is out of funds.":
			self.init(providerId: "vercel", activity: "summarize a library file")
		case "OpenRouter is out of funds.":
			self.init(providerId: "openrouter", activity: "summarize a library file")
		default:
			return nil
		}
	}

	static func post(_ notice: GatewayFundsNotice) {
		NotificationCenter.default.post(name: .gatewayFundsExhausted, object: notice)
	}

	static func post(from json: [String: Any]) {
		guard let notice = GatewayFundsNotice(json: json) else { return }
		post(notice)
	}
}

extension Error {
	var isGatewayFundsExhausted: Bool {
		if case .gatewayFunds = self as? TobyClientError { return true }
		return false
	}
}
