import SwiftUI

struct DashboardView: View {
	@Bindable var store: DashboardStore
	let userName: String
	let onboarding: OnboardingChecklist
	let onRefresh: () -> Void
	let onSelectRoute: (DetailRoute) -> Void
	var onOpenSettings: () -> Void = {}
	let onOpenPermissions: () -> Void
	let onStartChat: () -> Void
	let onSummarizeEmail: () -> Void

	@State private var now = Date()

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 24) {
				greeting
				if !onboarding.isComplete {
					OnboardingCard(checklist: onboarding, onStepAction: handleStepAction)
				}
				cards
			}
			.padding(AppTheme.contentPadding)
			.frame(maxWidth: 940, alignment: .leading)
			.frame(maxWidth: .infinity, alignment: .top)
		}
		.automaticScrollIndicators(axes: .vertical)
		.background(AppTheme.contentBackground)
		.task {
			now = Date()
			await store.load()
			await store.loadSummariesIfStale()
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
			UnreadMailCard(
				summary: store.email,
				aiSummary: store.emailSummary,
				isSummaryLoading: store.emailSummaryLoading,
				summaryError: store.emailSummaryError,
				isRefreshing: store.isEmailRefreshing,
				onRefresh: { Task { await store.refreshEmail() } },
				onSummarize: onSummarizeEmail
			)
			TasksCard(
				summary: store.tasks,
				aiSummary: store.tasksSummary,
				isSummaryLoading: store.tasksSummaryLoading,
				summaryError: store.tasksSummaryError,
				isRefreshing: store.isTasksRefreshing,
				onRefresh: { Task { await store.refreshTasks() } },
				onAddTask: onStartChat
			)
		}
	}

	private func handleStepAction(_ kind: OnboardingStepKind) {
		switch kind {
		case .configureAIProvider:
			onOpenSettings()
		case .connectIntegrations:
			onSelectRoute(.integrations)
		case .setupPersona:
			onOpenSettings()
		case .grantPermissions:
			onOpenPermissions()
		case .createSchedule:
			onSelectRoute(.schedules)
		case .createSkill:
			onSelectRoute(.skills)
		case .setupTranscription:
			onOpenSettings()
		case .recordAndTranscribe:
			onSelectRoute(.recordings)
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
