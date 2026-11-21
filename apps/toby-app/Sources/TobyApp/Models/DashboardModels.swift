import Foundation

/// Custom flow shown as a Home Actions tile (`GET /api/dashboard/flow-blocks`).
struct FlowDashboardBlockInfo: Decodable, Identifiable, Equatable {
	let id: String
	let flowId: String
	let title: String
	let description: String?
	let icon: String?
	let color: String?
	let variant: String
	let lastRanAt: String?
	let showsResultSheet: Bool?
	var dashboardColor: String? = nil

	var isRunner: Bool { variant == "runner" }
}

enum DashboardDate {
	static func parse(_ raw: String?) -> Date? {
		guard let raw, !raw.isEmpty else { return nil }
		let fractional = ISO8601DateFormatter()
		fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return fractional.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
	}
}
