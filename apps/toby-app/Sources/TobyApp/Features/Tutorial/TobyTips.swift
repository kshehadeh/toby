import TipKit

/// One-time TipKit setup for the tutorial and in-app tips.
@MainActor
enum TobyTips {
	private static var didConfigure = false

	static func configure() {
		guard !didConfigure else { return }
		didConfigure = true
		try? Tips.configure([.displayFrequency(.immediate)])
	}
}
