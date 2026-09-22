import Testing
@testable import TobyApp

@Suite("AI provider usage")
struct AIProviderUsageTests {
	@Test("period line lists today, this week, and this month")
	func periodLineListsAvailableWindows() {
		let usage = AIProviderUsage(
			providerId: "openrouter",
			supported: true,
			currency: "USD",
			totalSpent: 1.25,
			remaining: 8.75,
			totalSpentLabel: "$1.25",
			remainingLabel: "$8.75",
			spentDaily: 0.12,
			spentWeekly: 0.87,
			spentMonthly: 3.58,
			spentDailyLabel: "$0.12",
			spentWeeklyLabel: "$0.87",
			spentMonthlyLabel: "$3.58",
			unavailableReason: nil,
			fetchedAt: "2026-09-22T00:00:00.000Z"
		)

		#expect(usage.displaySummary == "$1.25 used · $8.75 left")
		#expect(
			usage.periodSummary
				== "$0.12 today · $0.87 this week · $3.58 this month"
		)
	}

	@Test("missing amounts render as a dash and a reported zero stays $0.00")
	func missingAmountsRenderAsDash() {
		let usage = AIProviderUsage(
			providerId: "vercel",
			supported: true,
			currency: "USD",
			totalSpent: 4.5,
			remaining: 95.5,
			totalSpentLabel: "$4.50",
			remainingLabel: "$95.50",
			spentDaily: 0,
			spentWeekly: nil,
			spentMonthly: nil,
			spentDailyLabel: "$0.00",
			spentWeeklyLabel: nil,
			spentMonthlyLabel: nil,
			unavailableReason: nil,
			fetchedAt: "2026-09-22T00:00:00.000Z"
		)

		#expect(usage.displaySummary == "$4.50 used · $95.50 left")
		#expect(
			usage.periodSummary
				== "$0.00 today · — this week · — this month"
		)
	}
}
