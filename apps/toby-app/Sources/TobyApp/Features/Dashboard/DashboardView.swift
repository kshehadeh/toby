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
	var onCreateSchedule: () -> Void = {}
	var onCreateSkill: () -> Void = {}
	var recentWork: [DashboardRecentWorkItem] = []
	var isRecentWorkLoading = false
	var onSelectRecentWork: (DashboardRecentWorkItem) -> Void = { _ in }
	/// Opens Settings, optionally deep-linking to a top-level section key
	/// (e.g. `"ai"`, `"transcription"`).
	var onOpenSettings: (String?) -> Void = { _ in }
	/// Opens guided AI setup, defaulting to OpenRouter browser sign-in.
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
	/// Leaves edit mode from the keyboard. Toolbar state remains owned by `RootView`.
	var onExitEditing: () -> Void = {}

	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	@State private var now = Date()
	@State private var draggingID: DashboardBlockID?
	@State private var dropPlacement: DashboardLayout.CardPlacement?
	@State private var slotFrames: [DashboardBlockID: CGRect] = [:]
	@State private var dragSpaceGlobal: CGRect = .zero
	@State private var layoutBeforeDrag: DashboardLayout?
	/// Frozen inspector ideal width for this presentation so persisting the
	/// user’s drag does not fight the system divider.
	@State private var actionsInspectorIdealWidth: CGFloat?

	/// Ready, incomplete, and not hidden from the checklist or Settings → Home.
	private var shouldShowOnboarding: Bool {
		isOnboardingReady
			&& !onboarding.isComplete
			&& !appearancePreferences.hideOnboarding
	}

	private var layoutSource: DashboardLayout {
		appearancePreferences.dashboardLayout
	}

	private var visibleHomeItems: [DashboardHomeItem] {
		layoutSource.resolvedVisibleHomeItems(from: store.registry.descriptors).map {
			DashboardHomeItem(id: $0)
		}
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

	private var usesNativeReordering: Bool {
		if #available(macOS 27.0, *) {
			return true
		}
		return false
	}

	/// Fingerprint of which dashboard sections are visible; drives insert/remove animation.
	private var sectionVisibilityKey: String {
		let hiddenKey = isEditing ? hiddenBlocks.map { "h:\($0.id.rawValue)" } : []
		let railKey = isActionsInspectorPresented ? "actions" : ""
		return ([shouldShowOnboarding ? "onboarding" : ""]
			+ visibleHomeItems.map(\.id.rawValue)
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
			.background(AppTheme.contentBackground)
			.inspector(isPresented: actionsInspectorPresented) {
				actionsInspector
			}
			.animation(sectionAnimation, value: sectionVisibilityKey)
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
					actionsInspectorIdealWidth = layoutSource.actionsWidth
				}
			}
			.task(id: isServerReady) {
				now = Date()
				guard isServerReady else { return }
				// Soft load: one content path per block (server caches OK).
				await store.updateAll(force: false)
			}
			.onReceive(NotificationCenter.default.publisher(for: .dashboardBlockShouldRefresh)) { note in
				guard let raw = note.object as? String else { return }
				Task { await store.refreshBlock(DashboardBlockID(raw)) }
			}
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
			.dropDestination(
				for: DashboardBlockID.self,
				isEnabled: isEditing && !usesNativeReordering
			) { items, session in
				beginCardDragIfNeeded(items.first)
				updateDropPlacement(at: globalPoint(fromLocal: session.location))
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
		if #available(macOS 27.0, *) {
			nativeReorderGrid
		} else {
			fallbackReorderGrid
		}
	}

	@available(macOS 27.0, *)
	private var nativeReorderGrid: some View {
		AdaptiveColumnLayout(minItemWidth: 320, maxItemWidth: 460, spacing: 20) {
			ForEach(visibleHomeItems) { item in
				editableHomeItem(item, usesManualDrag: false)
					.transition(DashboardSectionMotion.transition)
			}
			.reorderable()
		}
		.reorderContainer(for: DashboardHomeItem.self, isEnabled: isEditing) { difference in
			handleNativeReorder(difference)
		}
		.dropDestination(for: DashboardBlockID.self, isEnabled: isEditing) { ids, session in
			let destination = session.reorderDestination(for: DashboardHomeItem.self)
			let placement: DashboardLayout.CardPlacement
			switch destination?.position {
			case let .before(id): placement = .before(id)
			case .end, nil: placement = .end
			}
			handlePlacingHomeItems(ids, at: placement)
		}
	}

	private var fallbackReorderGrid: some View {
		AdaptiveColumnLayout(minItemWidth: 320, maxItemWidth: 460, spacing: 20) {
			ForEach(visibleHomeItems) { item in
				editableHomeItem(item, usesManualDrag: true)
					.transition(DashboardSectionMotion.transition)
			}
		}
	}

	@ViewBuilder
	private func editableHomeItem(
		_ item: DashboardHomeItem,
		usesManualDrag: Bool
	) -> some View {
		if item.id == .recentWork {
			editableRecentWork(usesManualDrag: usesManualDrag)
		} else if let block = store.registry.block(id: item.id) {
			editableCard(block, usesManualDrag: usesManualDrag)
		}
	}

	@ViewBuilder
	private func editableCard(
		_ block: CategoryDashboardBlock,
		usesManualDrag: Bool
	) -> some View {
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
					dropEdge: dropEdge(for: block.id),
					onHide: { handleHide(block.id) },
					onMoveEarlier: moveEarlierAction(for: block.id),
					onMoveLater: moveLaterAction(for: block.id)
				)
				.modifier(CardReorderModifier(
					id: block.id,
					title: block.title,
					systemImage: block.systemImage,
					enabled: usesManualDrag,
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
	private func editableRecentWork(usesManualDrag: Bool) -> some View {
		let id = DashboardBlockID.recentWork
		let isDragSource = draggingID == id
		ZStack(alignment: .topLeading) {
			DashboardRecentWorkSection(
				items: recentWork,
				isLoading: isRecentWorkLoading,
				onSelect: onSelectRecentWork
			)
			.allowsHitTesting(!isEditing)
			.opacity(isDragSource ? 0 : 1)
			if isEditing {
				DashboardEditOverlay(
					title: "Continue working",
					blockID: id,
					isDragging: isDragSource,
					dropEdge: dropEdge(for: id),
					onMoveEarlier: moveEarlierAction(for: id),
					onMoveLater: moveLaterAction(for: id)
				)
				.modifier(CardReorderModifier(
					id: id,
					title: "Continue working",
					systemImage: "clock.arrow.circlepath",
					enabled: usesManualDrag,
					onBegan: { beginCardDragIfNeeded(id) }
				))
				.accessibilityIdentifier("dashboard-edit-overlay-\(id.rawValue)")
			}
		}
		.contentShape(Rectangle())
		.onGeometryChange(for: CGRect.self) { proxy in
			proxy.frame(in: .global)
		} action: { frame in
			if slotFrames[id] != frame {
				slotFrames[id] = frame
			}
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
		DashboardBlockCard(
			block: block,
			actionContext: actionContext
		)
	}

	private func handleDragSession(_ session: DragSession) {
		guard !usesNativeReordering else { return }
		let ids = session.draggedItemIDs(for: DashboardBlockID.self)
		if let id = ids.first {
			beginCardDragIfNeeded(id)
		}
		switch session.phase {
		case .initial, .active:
			updateDropPlacement(at: globalPoint(fromLocal: session.location))
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
		guard !usesNativeReordering else { return }
		switch session.phase {
		case .entering, .active:
			updateDropPlacement(at: globalPoint(fromLocal: session.location))
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

	private func updateDropPlacement(at point: CGPoint) {
		let visibleIDs = Set(visibleHomeItems.map(\.id))
		let next = DashboardDropGeometry.placement(
			at: point,
			frames: slotFrames.filter { visibleIDs.contains($0.key) },
			draggingID: draggingID
		)
		if dropPlacement != next {
			dropPlacement = next
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
		dropPlacement = nil
	}

	private func cancelCardDrag() {
		if let origin = layoutBeforeDrag {
			appearancePreferences.dashboardLayout = origin
		}
		layoutBeforeDrag = nil
		draggingID = nil
		dropPlacement = nil
	}

	private func commitDrop() {
		guard let draggingID else {
			commitCardDrag()
			return
		}
		if let dropPlacement {
			handlePlacingHomeItems([draggingID], at: dropPlacement)
		}
		commitCardDrag()
	}

	private func handlePlacingHomeItems(
		_ ids: [DashboardBlockID],
		at placement: DashboardLayout.CardPlacement
	) {
		withAnimation(sectionAnimation) {
			appearancePreferences.dashboardLayout = appearancePreferences.dashboardLayout
				.placingVisibleHomeItems(ids, at: placement, from: store.registry.descriptors)
		}
	}

	@available(macOS 27.0, *)
	private func handleNativeReorder(
		_ difference: ReorderDifference<DashboardBlockID, ReorderableSingleCollectionIdentifier>
	) {
		let placement: DashboardLayout.CardPlacement
		switch difference.destination.position {
		case let .before(id): placement = .before(id)
		case .end: placement = .end
		}
		handlePlacingHomeItems(difference.sources, at: placement)
	}

	private func dropEdge(for id: DashboardBlockID) -> DashboardEditOverlay.DropEdge? {
		switch dropPlacement {
		case let .before(target) where target == id: .before
		case let .after(target) where target == id: .after
		case .end where visibleHomeItems.last?.id == id: .after
		default: nil
		}
	}

	private func moveEarlierAction(for id: DashboardBlockID) -> (() -> Void)? {
		let ids = visibleHomeItems.map(\.id)
		guard let index = ids.firstIndex(of: id), index > ids.startIndex else { return nil }
		let destination = ids[ids.index(before: index)]
		return { handlePlacingHomeItems([id], at: .before(destination)) }
	}

	private func moveLaterAction(for id: DashboardBlockID) -> (() -> Void)? {
		let ids = visibleHomeItems.map(\.id)
		guard let index = ids.firstIndex(of: id), index < ids.index(before: ids.endIndex) else {
			return nil
		}
		let destination = ids[ids.index(after: index)]
		return { handlePlacingHomeItems([id], at: .after(destination)) }
	}

	private func handleHide(_ id: DashboardBlockID) {
		withAnimation(sectionAnimation) {
			appearancePreferences.dashboardLayout = appearancePreferences.dashboardLayout
				.hidingHomeItem(id, from: store.registry.descriptors)
		}
	}

	private func handleShow(_ id: DashboardBlockID) {
		withAnimation(sectionAnimation) {
			appearancePreferences.dashboardLayout = appearancePreferences.dashboardLayout
				.showingHomeItem(id, from: store.registry.descriptors)
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
