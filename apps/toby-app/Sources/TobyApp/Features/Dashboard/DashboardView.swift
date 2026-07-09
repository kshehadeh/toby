import SwiftUI

struct DashboardView: View {
	@Bindable var store: DashboardStore
	let userName: String
	let onboarding: OnboardingChecklist
	let onRefresh: () -> Void
	let onSelectRoute: (DetailRoute) -> Void
	let onOpenPermissions: () -> Void
	let onStartChat: () -> Void
	let onSummarizeEmail: () -> Void
	let metrics: [DashboardMetric]

	@State private var now = Date()

	private let refreshTimer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 24) {
				greeting
				if !metrics.isEmpty {
					metricsRow
				}
				if !onboarding.isComplete {
					OnboardingCard(checklist: onboarding, onStepAction: handleStepAction)
				}
				cards
			}
			.padding(AppTheme.contentPadding)
			.frame(maxWidth: 940, alignment: .leading)
			.frame(maxWidth: .infinity, alignment: .top)
		}
		.background(AppTheme.contentBackground)
		.task { await store.load() }
		.onReceive(refreshTimer) { _ in
			now = Date()
			onRefresh()
		}
	}

	private var greeting: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("\(Self.greetingPrefix(for: now)), \(userName)")
				.font(.system(size: 26, weight: .bold))
				.foregroundStyle(AppTheme.primaryText)
			Text("\(Self.longDate(now)) · Here's what needs your attention.")
				.font(.system(size: 14))
				.foregroundStyle(AppTheme.secondaryText)
		}
	}

	private var cards: some View {
		HStack(alignment: .top, spacing: 20) {
			UnreadMailCard(summary: store.email, onSummarize: onSummarizeEmail)
			TasksCard(summary: store.tasks, onAddTask: onStartChat)
		}
	}

	private var metricsRow: some View {
		HStack(spacing: 12) {
			ForEach(metrics) { metric in
				DashboardMetricTile(metric: metric) {
					onSelectRoute(metric.route)
				}
			}
		}
	}

	private func handleStepAction(_ kind: OnboardingStepKind) {
		switch kind {
		case .configureAIProvider:
			onSelectRoute(.settings)
		case .connectIntegrations:
			onSelectRoute(.integrations)
		case .setupPersona:
			onSelectRoute(.settings)
		case .grantPermissions:
			onOpenPermissions()
		case .createSchedule:
			onSelectRoute(.schedules)
		case .samplePrompt:
			onStartChat()
		}
	}

	static func greetingPrefix(for date: Date) -> String {
		let hour = Calendar.current.component(.hour, from: date)
		switch hour {
		case 0 ..< 12: return "Good morning"
		case 12 ..< 18: return "Good afternoon"
		default: return "Good evening"
		}
	}

	static func longDate(_ date: Date) -> String {
		let formatter = DateFormatter()
		formatter.dateFormat = "EEEE, MMMM d"
		return formatter.string(from: date)
	}
}

extension DashboardView {
	/// The macOS account holder's first name, used for the greeting.
	static func defaultUserName() -> String {
		let full = NSFullUserName().trimmingCharacters(in: .whitespacesAndNewlines)
		if let first = full.split(separator: " ").first, !first.isEmpty {
			return String(first)
		}
		return "there"
	}
}
