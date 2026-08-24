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
	@State private var draggingID: DashboardBlockID?
	@State private var dropTargetID: DashboardBlockID?
	@State private var slotFrames: [DashboardBlockID: CGRect] = [:]
	@State private var dragSpaceGlobal: CGRect = .zero
	@State private var layoutBeforeDrag: DashboardLayout?
	/// Frozen inspector ideal width for this presentation so persisting the
	/// user’s drag does not fight the system divider.
	@State private var actionsInspectorIdealWidth: CGFloat?

	/// Ready, incomplete, and not dismissed via Settings → Dashboard.
	private var shouldShowOnboarding: Bool {
		isOnboardingReady
			&& !onboarding.isComplete
			&& !appearancePreferences.hideOnboarding
	}

	private var layoutSource: DashboardLayout {
		appearancePreferences.dashboardLayout
	}

	private var visibleCards: [CategoryDashboardBlock] {
		store.registry.orderedVisibleCards(layout: layoutSource)
	}

	private var visibleRunners: [CategoryDashboardBlock] {
		store.registry.orderedVisibleRunners(layout: layoutSource)
	}

	private var hiddenBlocks: [CategoryDashboardBlock] {
		store.registry.orderedHidden(layout: layoutSource)
	}

	private var isActionsInspectorPresented: Bool {
		layoutSource.actionsVisible && !visibleRunners.isEmpty
	}

	/// Fingerprint of which dashboard sections are visible; drives insert/remove animation.
	private var sectionVisibilityKey: String {
		let hiddenKey = isEditing ? hiddenBlocks.map { "h:\($0.id.rawValue)" } : []
		let railKey = isActionsInspectorPresented ? "actions" : ""
		return ([shouldShowOnboarding ? "onboarding" : ""]
			+ visibleCards.map(\.id.rawValue)
			+ visibleRunners.map { "r:\($0.id.rawValue)" }
			+ [railKey]
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
			.inspector(isPresented: actionsInspectorPresented) {
				actionsInspector
			}
			.animation(sectionAnimation, value: sectionVisibilityKey)
			.background(AppTheme.contentBackground)
			.environment(appearancePreferences)
			.environment(\.dashboardIsEditing, isEditing)
			.onAppear {
				if actionsInspectorIdealWidth == nil {
					actionsInspectorIdealWidth = layoutSource.actionsWidth
				}
			}
			.onChange(of: isEditing) { _, editing in
				if !editing {
					cancelCardDrag()
				}
			}
			.onChange(of: appearancePreferences.dashboardLayout) { _, layout in
				if layout == .empty {
					actionsInspectorIdealWidth = layout.actionsWidth
				}
			}
			.onChange(of: isActionsInspectorPresented) { _, presented in
				if presented {
					actionsInspectorIdealWidth = layoutSource.actionsWidth
				}
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

	private var mainScroll: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 24) {
				greeting
				if shouldShowOnboarding {
					OnboardingCard(checklist: onboarding, onStepAction: handleStepAction)
						.transition(DashboardSectionMotion.transition)
				}
				cardGrid
				if isEditing, !hiddenBlocks.isEmpty {
					DashboardHiddenBlocksTray(
						blocks: hiddenBlocks,
						onShow: handleShow,
						onDragBegan: { beginCardDragIfNeeded($0) }
					)
					.transition(DashboardSectionMotion.transition)
				}
			}
			.padding(AppTheme.contentPadding)
			.frame(maxWidth: DashboardBlockLayout.cardsMaxWidth, alignment: .leading)
			.frame(maxWidth: .infinity, alignment: .top)
			.dragConfiguration(DragConfiguration(allowMove: true))
			.dropConfiguration { _ in DropConfiguration(operation: .move) }
			.dropDestination(for: DashboardBlockID.self, isEnabled: isEditing) { items, session in
				beginCardDragIfNeeded(items.first)
				updateDropTarget(at: globalPoint(fromLocal: session.location))
				commitDrop()
			}
			.onGeometryChange(for: CGRect.self) { proxy in
				proxy.frame(in: .global)
			} action: { dragSpaceGlobal = $0 }
			.onDragSessionUpdated(handleDragSession)
			.onDropSessionUpdated(handleDropSession)
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
			ideal: actionsInspectorIdealWidth ?? layoutSource.actionsWidth,
			max: DashboardBlockLayout.actionsRailMaxWidth
		)
	}

	@ViewBuilder
	private var cardGrid: some View {
		if !visibleCards.isEmpty {
			AdaptiveColumnLayout(minItemWidth: 280, spacing: 20) {
				ForEach(visibleCards) { block in
					editableCard(block)
						.transition(DashboardSectionMotion.transition)
				}
			}
		} else if isEditing {
			Color.clear
				.frame(maxWidth: .infinity)
				.frame(minHeight: 64)
		}
	}

	@ViewBuilder
	private func editableCard(_ block: CategoryDashboardBlock) -> some View {
		let isDragSource = draggingID == block.id
		ZStack(alignment: .topLeading) {
			blockCard(block)
				.allowsHitTesting(!isEditing)
				.opacity(isDragSource ? 0 : 1)
			if isEditing {
				DashboardEditOverlay(
					title: block.title,
					blockID: block.id,
					isDragging: isDragSource,
					isDropTarget: dropTargetID == block.id,
					onHide: { handleHide(block.id) }
				)
				.modifier(CardReorderModifier(
					id: block.id,
					title: block.title,
					systemImage: block.systemImage,
					enabled: true,
					onBegan: { beginCardDragIfNeeded(block.id) }
				))
				.accessibilityIdentifier("dashboard-edit-overlay-\(block.id.rawValue)")
			}
		}
		.contentShape(Rectangle())
		.onGeometryChange(for: CGRect.self) { proxy in
			proxy.frame(in: .global)
		} action: { frame in
			if slotFrames[block.id] != frame {
				slotFrames[block.id] = frame
			}
		}
	}

	@ViewBuilder
	private func editableRunner(_ block: CategoryDashboardBlock) -> some View {
		ZStack(alignment: .topLeading) {
			DashboardActionRunnerRow(
				block: block,
				actionContext: actionContext
			)
			.allowsHitTesting(!isEditing)
			if isEditing {
				DashboardEditOverlay(
					title: block.title,
					blockID: block.id,
					compact: true,
					showsHandle: false,
					onHide: { handleHide(block.id) }
				)
				.accessibilityIdentifier("dashboard-edit-overlay-\(block.id.rawValue)")
			}
		}
		.contentShape(Rectangle())
	}

	@ViewBuilder
	private func blockCard(_ block: CategoryDashboardBlock) -> some View {
		DashboardBlockCard(block: block, actionContext: actionContext)
	}

	private func handleDragSession(_ session: DragSession) {
		let ids = session.draggedItemIDs(for: DashboardBlockID.self)
		if let id = ids.first {
			beginCardDragIfNeeded(id)
		}
		switch session.phase {
		case .initial, .active:
			updateDropTarget(at: globalPoint(fromLocal: session.location))
		case let .ended(operation):
			switch operation {
			case .cancel, .forbidden:
				cancelCardDrag()
			default:
				commitDrop()
			}
		default:
			break
		}
	}

	private func handleDropSession(_ session: DropSession) {
		switch session.phase {
		case .entering, .active:
			updateDropTarget(at: globalPoint(fromLocal: session.location))
		case let .ended(operation):
			switch operation {
			case .cancel, .forbidden:
				cancelCardDrag()
			default:
				break
			}
		default:
			break
		}
	}

	private func globalPoint(fromLocal point: CGPoint) -> CGPoint {
		CGPoint(x: dragSpaceGlobal.minX + point.x, y: dragSpaceGlobal.minY + point.y)
	}

	private func updateDropTarget(at point: CGPoint) {
		let visibleIDs = Set(visibleCards.map(\.id))
		let next = DashboardDropGeometry.insertBeforeID(
			at: point,
			frames: slotFrames.filter { visibleIDs.contains($0.key) },
			draggingID: draggingID
		)
		if dropTargetID != next {
			dropTargetID = next
		}
	}

	private func beginCardDragIfNeeded(_ id: DashboardBlockID?) {
		guard let id else { return }
		if layoutBeforeDrag == nil {
			layoutBeforeDrag = appearancePreferences.dashboardLayout
		}
		draggingID = id
	}

	private func commitCardDrag() {
		layoutBeforeDrag = nil
		draggingID = nil
		dropTargetID = nil
	}

	private func cancelCardDrag() {
		if let origin = layoutBeforeDrag {
			appearancePreferences.dashboardLayout = origin
		}
		layoutBeforeDrag = nil
		draggingID = nil
		dropTargetID = nil
	}

	private func commitDrop() {
		guard let draggingID else {
			commitCardDrag()
			return
		}
		if let dropTargetID {
			handlePlacingCards([draggingID], at: .before(dropTargetID))
		}
		commitCardDrag()
	}

	private func handlePlacingCards(
		_ ids: [DashboardBlockID],
		at placement: DashboardLayout.CardPlacement
	) {
		withAnimation(sectionAnimation) {
			appearancePreferences.dashboardLayout = appearancePreferences.dashboardLayout
				.placingVisibleCards(ids, at: placement, from: store.registry.descriptors)
		}
	}

	private func handleHide(_ id: DashboardBlockID) {
		withAnimation(sectionAnimation) {
			appearancePreferences.dashboardLayout = appearancePreferences.dashboardLayout
				.hiding(id, from: store.registry.descriptors)
		}
	}

	private func handleShow(_ id: DashboardBlockID) {
		withAnimation(sectionAnimation) {
			appearancePreferences.dashboardLayout = appearancePreferences.dashboardLayout
				.showing(id, at: nil, from: store.registry.descriptors)
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
