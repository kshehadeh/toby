import Foundation

struct FlowIconOption: Identifiable, Equatable {
	let symbol: String
	let label: String

	var id: String { symbol }

	static let defaultSymbol = "arrow.triangle.branch"

	/// Keep in sync with FLOW_ICON_SYMBOLS in @toby/core.
	static let all: [FlowIconOption] = [
		.init(symbol: defaultSymbol, label: "Flow"),
		.init(symbol: "bolt.fill", label: "Bolt"),
		.init(symbol: "sparkles", label: "Sparkles"),
		.init(symbol: "wand.and.stars", label: "Magic"),
		.init(symbol: "play.circle", label: "Run"),
		.init(symbol: "gearshape", label: "Settings"),
		.init(symbol: "clock", label: "Clock"),
		.init(symbol: "calendar", label: "Calendar"),
		.init(symbol: "checklist", label: "Tasks"),
		.init(symbol: "envelope", label: "Mail"),
		.init(symbol: "tray", label: "Inbox"),
		.init(symbol: "paperplane", label: "Send"),
		.init(symbol: "bell", label: "Alert"),
		.init(symbol: "flag", label: "Flag"),
		.init(symbol: "bookmark", label: "Bookmark"),
		.init(symbol: "star", label: "Star"),
		.init(symbol: "heart", label: "Heart"),
		.init(symbol: "house", label: "Home"),
		.init(symbol: "briefcase", label: "Work"),
		.init(symbol: "folder", label: "Folder"),
		.init(symbol: "doc.text", label: "Document"),
		.init(symbol: "person", label: "Person"),
		.init(symbol: "bubble.left", label: "Message"),
		.init(symbol: "link", label: "Link"),
		.init(symbol: "globe", label: "Web"),
		.init(symbol: "laptopcomputer", label: "Computer"),
		.init(symbol: "moon", label: "Moon"),
		.init(symbol: "sun.max", label: "Sun"),
		.init(symbol: "flame", label: "Focus"),
		.init(symbol: "leaf", label: "Leaf"),
		.init(symbol: "cart", label: "Cart"),
		.init(symbol: "bag", label: "Bag"),
		.init(symbol: "hammer", label: "Build"),
		.init(symbol: "wrench.and.screwdriver", label: "Tools"),
	]

	static func resolvedSymbol(_ symbol: String?, fallback: String = defaultSymbol) -> String {
		guard let symbol, all.contains(where: { $0.symbol == symbol }) else {
			return fallback
		}
		return symbol
	}
}
