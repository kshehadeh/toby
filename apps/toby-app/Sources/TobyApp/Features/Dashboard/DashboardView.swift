import AppKit
import SwiftUI

/// Shared motion for Home section insert/remove (onboarding, Actions).
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
	/// When true, daemon is ready for HTTP; soft-loads Home data.
	var isServerReady: Bool = true
	let onRefresh: () -> Void
	let onSelectRoute: (DetailRoute) -> Void
	var onCreateSchedule: () -> Void = {}
	var onCreateSkill: () -> Void = {}
	/// Opens Settings, optionally deep-linking to a top-level section key
	/// (e.g. `"ai"`, `"transcription"`).
	var onOpenSettings: (String?) -> Void = { _ in }
	/// Opens guided AI setup, defaulting to OpenRouter browser sign-in.
	var onOpenAIProviderSetup: () -> Void = {}
	/// Opens the sidebar persona picker with attention highlighting.
	var onOpenPersonaPicker: () -> Void = {}
	let onOpenPermissions: () -> Void
	/// Shell hooks for Feed and Actions (chat prompts, flow runs, toasts).
	var actionContext: DashboardBlockActionContext = .init()
	/// Client-local prefs (theme / hide onboarding). Defaults to the shared store.
	@Bindable var appearancePreferences: AppearancePreferences = .shared
	/// Session-only Actions editor (hide / recolor tiles). Toolbar toggle lives on `RootView`.
	var isEditing: Bool = false
	/// Leaves edit mode from the keyboard. Toolbar state remains owned by `RootView`.
	var onExitEditing: () -> Void = {}
	/// "Guide The Feed" sheet; the toolbar button lives on `RootView`.
	var isShowingFeedInstructions: Binding<Bool> = .constant(false)

	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	@State private var now = Date()
	/// Frozen inspector ideal width for this presentation so persisting the
	/// user’s drag does not fight the system divider.
	@State private var actionsInspectorIdealWidth: CGFloat?

	/// Ready, incomplete, and not hidden from the checklist or Settings → Home.
	private var shouldShowOnboarding: Bool {
		isOnboardingReady
			&& !onboarding.isComplete
			&& !appearancePreferences.hideOnboarding
	}

	private var layout: DashboardLayout { appearancePreferences.dashboardLayout }

	private var visibleRunners: [CategoryDashboardBlock] {
		store.registry.orderedVisibleRunners(layout: layout)
	}

	private var hiddenRunners: [CategoryDashboardBlock] {
		store.registry.orderedHidden(layout: layout)
	}

	private var isActionsInspectorPresented: Bool {
		layout.actionsVisible && !visibleRunners.isEmpty
	}

	/// Fingerprint of which Home sections are visible; drives insert/remove animation.
	private var sectionVisibilityKey: String {
		let hiddenKey = isEditing ? hiddenRunners.map { "h:\($0.id.rawValue)" } : []
		return ([shouldShowOnboarding ? "onboarding" : ""]
			+ visibleRunners.map { "r:\($0.id.rawValue)" }
			+ [isActionsInspectorPresented ? "actions" : ""]
			+ hiddenKey).joined(separator: "|")
	}

	private var sectionAnimation: Animation? {
		reduceMotion ? nil : DashboardSectionMotion.animation
	}

	private var actionsInspectorPresented: Binding<Bool> {
		Binding(
			get: { isActionsInspectorPresented },
			set: { presented in
				var next = appearancePreferences.dashboardLayout
				next.actionsVisible = presented
				appearancePreferences.dashboardLayout = next
			}
		)
	}

	var body: some View {
		mainScroll
			.background(AppTheme.contentBackground)
			.inspector(isPresented: actionsInspectorPresented) {
				actionsInspector
			}
			.animation(sectionAnimation, value: sectionVisibilityKey)
			.environment(appearancePreferences)
			.environment(\.dashboardIsEditing, isEditing)
			.onAppear {
				if actionsInspectorIdealWidth == nil {
					actionsInspectorIdealWidth = layout.actionsWidth
				}
			}
			.onExitCommand {
				guard isEditing else { return }
				onExitEditing()
			}
			.onChange(of: appearancePreferences.dashboardLayout) { _, layout in
				if layout == .empty {
					actionsInspectorIdealWidth = layout.actionsWidth
				}
			}
			.onChange(of: isActionsInspectorPresented) { _, presented in
				if presented {
					actionsInspectorIdealWidth = layout.actionsWidth
				}
			}
			.task(id: isServerReady) {
				now = Date()
				guard isServerReady else { return }
				await store.updateAll(force: false)
			}
			.onReceive(NotificationCenter.default.publisher(for: .flowDefinitionsDidChange)) { _ in
				Task { await store.syncFlowBlocks() }
			}
			.sheet(isPresented: isShowingFeedInstructions, onDismiss: feedInstructionsDismissed) {
				FeedInstructionsSheet(store: store.feedInstructions) {
					isShowingFeedInstructions.wrappedValue = false
				}
			}
	}

	/// Re-rank once after the instructions sheet closes if anything changed.
	private func feedInstructionsDismissed() {
		guard store.feedInstructions.consumeChanges() else { return }
		Task { await store.feed.update(force: true) }
	}

	private var greeting: some View {
		HStack(alignment: .top, spacing: 16) {
			VStack(alignment: .leading, spacing: 3) {
				Text("\(Self.greetingPrefix(for: now)), \(userName)")
					.font(.system(size: 26, weight: .bold))
					.tracking(-0.45)
					.foregroundStyle(AppTheme.primaryText)
				Text(Self.longDate(now))
					.font(.system(size: 13))
					.foregroundStyle(AppTheme.secondaryText)
			}
			Spacer(minLength: 0)
			if store.isRefreshing {
				ProgressView()
					.controlSize(.small)
					.accessibilityLabel("Updating Home")
			}
		}
	}

	private var mainScroll: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 24) {
				greeting
				if shouldShowOnboarding {
					OnboardingCard(
						checklist: onboarding,
						onStepAction: handleStepAction,
						onHide: {
							appearancePreferences.hideOnboardingBinding.wrappedValue = true
						}
					)
					.transition(DashboardSectionMotion.transition)
				}
				feedSection
				if isEditing, !hiddenRunners.isEmpty {
					DashboardHiddenActionsTray(blocks: hiddenRunners, onShow: handleShow)
						.transition(DashboardSectionMotion.transition)
				}
			}
			.padding(AppTheme.contentPadding)
			.frame(maxWidth: DashboardBlockLayout.cardsMaxWidth, alignment: .leading)
			.frame(maxWidth: .infinity, alignment: .top)
		}
		.automaticScrollIndicators(axes: .vertical)
		.frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
	}

	@ViewBuilder
	private var actionsInspector: some View {
		DashboardActionRunnersRail(blocks: visibleRunners) { block in
			editableRunner(block)
		}
		.padding(.top, 8)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.inspectorColumnWidth(
			min: DashboardBlockLayout.actionsRailMinWidth,
			ideal: actionsInspectorIdealWidth ?? layout.actionsWidth,
			max: DashboardBlockLayout.actionsRailMaxWidth
		)
	}

	private var feedSection: some View {
		FeedCardView(
			store: store.feed,
			onPerform: performFeedAction,
			onOutcome: showFeedOutcome,
			onOpenSettings: { onOpenSettings("dashboard") },
			onGuide: { isShowingFeedInstructions.wrappedValue = true }
		)
		.allowsHitTesting(!isEditing)
		.opacity(isEditing ? 0.6 : 1)
		.task(id: isServerReady) {
			guard isServerReady else { return }
			// Pick up background refreshes while Home is open (soft, cached).
			while !Task.isCancelled {
				try? await Task.sleep(for: Self.feedPollInterval)
				guard !Task.isCancelled else { break }
				await store.feed.update(force: false)
			}
		}
	}

	private static let feedPollInterval: Duration = .seconds(5 * 60)

	private func showFeedOutcome(_ outcome: FeedActionOutcome) {
		switch outcome {
		case .success(let message):
			actionContext.showToast(AppToastState(style: .success, title: message))
		case .failure(let message):
			actionContext.showToast(AppToastState(style: .error, title: "Couldn't do that", message: message))
		}
	}

	/// Chat actions open a seeded chat; open actions launch the item URL.
	private func performFeedAction(_ action: FeedAction) {
		switch action.kind {
		case .chat:
			guard let prompt = action.prompt, !prompt.isEmpty else { return }
			actionContext.startChatWithPrompt(prompt)
		case .open:
			guard let raw = action.url, let url = URL(string: raw) else { return }
			NSWorkspace.shared.open(url)
		case .tool, .local:
			break
		}
	}

	@ViewBuilder
	private func editableRunner(_ block: CategoryDashboardBlock) -> some View {
		ZStack(alignment: .topLeading) {
			DashboardActionRunnerRow(
				block: block,
				actionContext: actionContext,
				appearancePreferences: appearancePreferences
			)
			.allowsHitTesting(!isEditing)
			if isEditing {
				DashboardEditOverlay(
					title: block.title,
					blockID: block.id,
					onHide: { handleHide(block.id) },
					colorSelection: colorBinding(for: block.id)
				)
				.accessibilityIdentifier("dashboard-edit-overlay-\(block.id.rawValue)")
			}
		}
		.contentShape(Rectangle())
	}

	private func colorBinding(for id: DashboardBlockID) -> Binding<String> {
		Binding(
			get: { appearancePreferences.dashboardLayout.colorOverrides[id.rawValue] ?? "" },
			set: { color in
				appearancePreferences.dashboardLayout = appearancePreferences.dashboardLayout.settingColor(color, for: id)
			}
		)
	}

	private func handleHide(_ id: DashboardBlockID) {
		withAnimation(sectionAnimation) {
			appearancePreferences.setDashboardBlockVisible(id: id, visible: false)
		}
	}

	private func handleShow(_ id: DashboardBlockID) {
		withAnimation(sectionAnimation) {
			appearancePreferences.setDashboardBlockVisible(id: id, visible: true)
		}
	}

	private func handleStepAction(_ kind: OnboardingStepKind) {
		switch kind {
		case .configureAIProvider:
			onOpenAIProviderSetup()
		case .connectIntegrations:
			onOpenSettings(SettingsItem.integrationsSectionKey)
		case .setupPersona:
			onOpenPersonaPicker()
		case .grantPermissions:
			onOpenPermissions()
		case .createSchedule:
			onCreateSchedule()
		case .createSkill:
			onCreateSkill()
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
		userName(from: NSFullUserName())
	}

	/// Short greeting name from a macOS full name.
	/// Supports `"First Last"` and `"Last, First"` (last-name-first with comma).
	static func userName(from fullName: String) -> String {
		let full = fullName.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !full.isEmpty else { return "there" }

		// "Shehadeh, Karim" → first name after the comma
		if let comma = full.firstIndex(of: ",") {
			let afterComma = full[full.index(after: comma)...]
				.trimmingCharacters(in: .whitespacesAndNewlines)
			if let first = afterComma.split(separator: " ").first, !first.isEmpty {
				return String(first)
			}
		}

		if let first = full.split(separator: " ").first, !first.isEmpty {
			return String(first)
		}
		return "there"
	}
}
