import AppKit
import SwiftUI

/// Shared motion for dashboard section insert/remove (cards + onboarding).
/// Computed (not stored) so non-Sendable `AnyTransition` stays concurrency-safe.
enum DashboardSectionMotion {
	/// Matches toast / lightweight chrome springs used elsewhere in Toby.app.
	static var animation: Animation {
		.spring(response: 0.32, dampingFraction: 0.86)
	}

	/// Fade + slight scale/slide so sections feel like they settle into place.
	static var transition: AnyTransition {
		.asymmetric(
			insertion: .opacity
				.combined(with: .scale(scale: 0.97, anchor: .top))
				.combined(with: .offset(y: 8)),
			removal: .opacity
				.combined(with: .scale(scale: 0.97, anchor: .top))
		)
	}
}

struct DashboardView: View {
	@Bindable var store: DashboardStore
	let userName: String
	let onboarding: OnboardingChecklist
	/// When false, hide onboarding entirely (app still bootstrapping / loading
	/// status, schedules, skills, recordings, permissions). Avoids a flash of
	/// incomplete checklist steps that disappear once data arrives.
	var isOnboardingReady: Bool = true
	/// When true, daemon is ready for HTTP; soft-loads dashboard data.
	var isServerReady: Bool = true
	let onRefresh: () -> Void
	let onSelectRoute: (DetailRoute) -> Void
	/// Opens Settings, optionally deep-linking to a top-level section key
	/// (e.g. `"ai"`, `"transcription"`).
	var onOpenSettings: (String?) -> Void = { _ in }
	/// Opens the guided Vercel AI Gateway setup wizard (recommended first-run path).
	var onOpenAIProviderSetup: () -> Void = {}
	/// Opens the sidebar persona picker with attention highlighting.
	var onOpenPersonaPicker: () -> Void = {}
	let onOpenPermissions: () -> Void
	/// Shell hooks for block menu actions (chat prompts, etc.).
	var actionContext: DashboardBlockActionContext = .init()
	/// Client-local prefs (theme / hide onboarding). Defaults to the shared store.
	@Bindable var appearancePreferences: AppearancePreferences = .shared

	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	@State private var now = Date()

	/// Ready, incomplete, and not dismissed via Settings → Dashboard.
	private var shouldShowOnboarding: Bool {
		isOnboardingReady
			&& !onboarding.isComplete
			&& !appearancePreferences.hideOnboarding
	}

	private var visibleBlocks: [CategoryDashboardBlock] {
		store.registry.orderedVisible(preferences: appearancePreferences)
	}

	/// Fingerprint of which dashboard sections are visible; drives insert/remove animation.
	private var sectionVisibilityKey: String {
		([shouldShowOnboarding ? "onboarding" : ""]
			+ visibleBlocks.map(\.id.rawValue)).joined(separator: "|")
	}

	private var sectionAnimation: Animation? {
		reduceMotion ? nil : DashboardSectionMotion.animation
	}

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 24) {
				greeting
				if shouldShowOnboarding {
					OnboardingCard(checklist: onboarding, onStepAction: handleStepAction)
						.transition(DashboardSectionMotion.transition)
				}
				cards
			}
			.animation(sectionAnimation, value: sectionVisibilityKey)
			.padding(AppTheme.contentPadding)
			.frame(maxWidth: 940, alignment: .leading)
			.frame(maxWidth: .infinity, alignment: .top)
		}
		.automaticScrollIndicators(axes: .vertical)
		.background(AppTheme.contentBackground)
		.task(id: isServerReady) {
			now = Date()
			guard isServerReady else { return }
			// Soft load: one content path per block (server caches OK).
			await store.updateAll(force: false)
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

	/// Adaptive columns: as many as fit above `minimum`, so the dashboard
	/// reflows 3 → 2 → 1 as the window narrows. Onboarding stays outside this grid.
	private static let cardColumns = [
		GridItem(.adaptive(minimum: 280, maximum: .infinity), spacing: 20, alignment: .top),
	]

	@ViewBuilder
	private var cards: some View {
		if !visibleBlocks.isEmpty {
			LazyVGrid(columns: Self.cardColumns, alignment: .leading, spacing: 20) {
				ForEach(visibleBlocks, id: \.id) { block in
					DashboardBlockCard(block: block, actionContext: actionContext)
						.transition(DashboardSectionMotion.transition)
				}
			}
			.transition(DashboardSectionMotion.transition)
		}
	}

	private func handleStepAction(_ kind: OnboardingStepKind) {
		switch kind {
		case .configureAIProvider:
			onOpenAIProviderSetup()
		case .connectIntegrations:
			onSelectRoute(.integrations)
		case .setupPersona:
			onOpenPersonaPicker()
		case .grantPermissions:
			onOpenPermissions()
		case .createSchedule:
			onSelectRoute(.schedules)
		case .createSkill:
			onSelectRoute(.skills)
		case .setupTranscription:
			onOpenSettings("transcription")
		case .recordAndTranscribe:
			onSelectRoute(.recordings)
		case .samplePrompt:
			actionContext.startChat()
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
