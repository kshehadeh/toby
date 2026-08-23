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
	/// Session-only layout editor. Toolbar toggle lives on `RootView`.
	var isEditing: Bool = false

	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	@State private var now = Date()
	@State private var editor = DashboardLayoutEditor()
	@State private var hoveredID: DashboardBlockID?
	@State private var slotFrames: [DashboardSlotFrame] = []
	@State private var trayFrame: CGRect = .null

	/// Ready, incomplete, and not dismissed via Settings → Dashboard.
	private var shouldShowOnboarding: Bool {
		isOnboardingReady
			&& !onboarding.isComplete
			&& !appearancePreferences.hideOnboarding
	}

	private var layoutSource: DashboardLayout {
		// During a drag, only the draft is ahead of prefs. Otherwise prefs is
		// canonical so the grid is correct before `onAppear` (and in tests).
		if isEditing, editor.isDragging {
			return editor.draft
		}
		return appearancePreferences.dashboardLayout
	}

	private var visibleBlocks: [CategoryDashboardBlock] {
		store.registry.orderedVisible(layout: layoutSource)
	}

	private var hiddenBlocks: [CategoryDashboardBlock] {
		store.registry.orderedHidden(layout: layoutSource)
	}

	/// Fingerprint of which dashboard sections are visible; drives insert/remove animation.
	private var sectionVisibilityKey: String {
		let hiddenKey = isEditing ? hiddenBlocks.map { "h:\($0.id.rawValue)" } : []
		return ([shouldShowOnboarding ? "onboarding" : ""]
			+ visibleBlocks.map(\.id.rawValue)
			+ hiddenKey).joined(separator: "|")
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
				if isEditing, !hiddenBlocks.isEmpty {
					DashboardHiddenBlocksTray(
						blocks: hiddenBlocks,
						draggingID: editor.draggingID,
						onShow: handleShow,
						onDragChanged: { id, value in
							handleDragChanged(id: id, fromTray: true, value: value)
						},
						onDragEnded: handleDragEnded
					)
					.transition(DashboardSectionMotion.transition)
				}
			}
			.coordinateSpace(name: DashboardEditSpace.name)
			.overlay(alignment: .topLeading) {
				dragPreview
			}
			.animation(sectionAnimation, value: sectionVisibilityKey)
			.padding(AppTheme.contentPadding)
			.frame(maxWidth: 940, alignment: .leading)
			.frame(maxWidth: .infinity, alignment: .top)
		}
		.automaticScrollIndicators(axes: .vertical)
		.background(AppTheme.contentBackground)
		.environment(\.dashboardIsEditing, isEditing)
		.onPreferenceChange(DashboardSlotFramesKey.self) { slotFrames = $0 }
		.onPreferenceChange(DashboardTrayFrameKey.self) { trayFrame = $0 }
		.onAppear {
			bindEditorPointerHandlers()
			if isEditing {
				editor.sync(from: appearancePreferences.dashboardLayout)
			}
		}
		.onChange(of: isEditing) { _, editing in
			if editing {
				editor.sync(from: appearancePreferences.dashboardLayout)
			} else {
				editor.cancelDrag()
				hoveredID = nil
			}
		}
		.onChange(of: appearancePreferences.dashboardLayout) { _, layout in
			editor.sync(from: layout)
		}
		.onDisappear {
			editor.cancelDrag()
		}
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

	@ViewBuilder
	private var cards: some View {
		if !visibleBlocks.isEmpty {
			AdaptiveColumnLayout(minItemWidth: 280, spacing: 20) {
				ForEach(visibleBlocks, id: \.id) { block in
					editableCard(block)
						.transition(DashboardSectionMotion.transition)
				}
			}
			.transition(DashboardSectionMotion.transition)
		}
	}

	@ViewBuilder
	private func editableCard(_ block: CategoryDashboardBlock) -> some View {
		let isDragSource = editor.draggingID == block.id
		let isHovered = hoveredID == block.id
		ZStack(alignment: .topLeading) {
			blockCard(block)
				.allowsHitTesting(!isEditing)
				.opacity(isDragSource ? 0 : 1)
			if isEditing {
				if isDragSource {
					RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
						.stroke(style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
						.foregroundStyle(AppTheme.accent.opacity(0.55))
						.padding(.top, 22)
						.padding(.leading, 18)
				}
				DashboardEditOverlay(
					title: block.title,
					blockID: block.id,
					isHovered: isHovered,
					isDragging: editor.isDragging,
					onHide: { handleHide(block.id) },
					onDragChanged: { value in
						handleDragChanged(id: block.id, fromTray: false, value: value)
					},
					onDragEnded: handleDragEnded
				)
				.padding(.top, 22)
				.padding(.leading, 18)
				.accessibilityIdentifier("dashboard-edit-overlay-\(block.id.rawValue)")
			}
		}
		.dashboardSlotFrame(id: block.id)
		.contentShape(Rectangle())
		.onHover { hovering in
			guard isEditing, editor.draggingID == nil else {
				if !hovering, hoveredID == block.id {
					hoveredID = nil
				}
				return
			}
			hoveredID = hovering ? block.id : (hoveredID == block.id ? nil : hoveredID)
		}
	}

	@ViewBuilder
	private func blockCard(_ block: CategoryDashboardBlock) -> some View {
		if block.descriptor.isFlowRunner {
			FlowRunnerDashboardCard(block: block, actionContext: actionContext)
		} else {
			DashboardBlockCard(block: block, actionContext: actionContext)
		}
	}

	@ViewBuilder
	private var dragPreview: some View {
		if let id = editor.draggingID,
			let location = editor.dragLocation,
			let block = store.registry.block(id: id)
		{
			let chip = editor.isDraggingFromTray && editor.draft.isHidden(id: id)
			DashboardDragPreview(
				title: block.title,
				systemImage: block.systemImage,
				isChip: chip
			)
			.position(location)
		}
	}

	private func bindEditorPointerHandlers() {
		editor.onPointerUp = { handleDragEnded() }
	}

	private func handleDragChanged(id: DashboardBlockID, fromTray: Bool, value: DragGesture.Value) {
		if editor.draggingID == nil {
			editor.sync(from: appearancePreferences.dashboardLayout)
			editor.beginDrag(id: id, fromTray: fromTray, location: value.location)
		}
		handleDragMoved(value.location)
	}

	private func handleDragMoved(_ location: CGPoint) {
		withAnimation(sectionAnimation) {
			editor.updateDrag(
				location: location,
				slots: slotFrames,
				trayFrame: trayFrame == .null ? nil : trayFrame,
				descriptors: store.registry.descriptors
			)
		}
	}

	private func handleDragEnded() {
		if let committed = editor.endDrag(commit: true) {
			appearancePreferences.dashboardLayout = committed
		}
	}

	private func handleHide(_ id: DashboardBlockID) {
		editor.sync(from: appearancePreferences.dashboardLayout)
		withAnimation(sectionAnimation) {
			let next = editor.hide(id, from: store.registry.descriptors)
			appearancePreferences.dashboardLayout = next
		}
	}

	private func handleShow(_ id: DashboardBlockID) {
		editor.sync(from: appearancePreferences.dashboardLayout)
		withAnimation(sectionAnimation) {
			let next = editor.showAppending(id, from: store.registry.descriptors)
			appearancePreferences.dashboardLayout = next
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
