import Foundation
import TobyAI

/// Persistent notice that the OpenRouter account has no credit left for a request.
struct GatewayFundsNotice: Equatable {
	/// Error codes that mean "out of credits" (`insufficient_credits` from the
	/// native core; `gateway_funds_exhausted` from older run records).
	static let codes: Set<String> = ["insufficient_credits", "gateway_funds_exhausted"]

	let activity: String

	var title: String { "OpenRouter is out of credits" }
	var message: String { "Toby couldn't \(activity)." }
	/// Short sentence used on the surface that failed.
	var detailMessage: String { "Your OpenRouter account is out of credits." }
	var settingsNavKey: String { "account" }

	init(activity: String) {
		self.activity = activity
	}

	/// Decode a result payload (`code`, `activity`).
	init?(json: [String: Any]) {
		guard
			let code = json["code"] as? String, Self.codes.contains(code),
			let activity = json["activity"] as? String,
			!activity.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
		else { return nil }
		self.init(activity: activity)
	}

	/// Library indexing stores only the error sentence on the item.
	init?(libraryError message: String) {
		let text = message.lowercased()
		guard text.contains("out of credits") || text.contains("out of funds") || text.contains("insufficient credits") else { return nil }
		self.init(activity: "summarize a library file")
	}

	/// The notice for an out-of-credits AI error, if `error` is one.
	init?(error: Error, activity: String) {
		guard case .insufficientCredits = error as? AIError else { return nil }
		self.init(activity: activity)
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
		if case .insufficientCredits = self as? AIError { return true }
		return false
	}
}
