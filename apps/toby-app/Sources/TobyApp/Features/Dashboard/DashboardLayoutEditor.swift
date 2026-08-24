import AppKit
import Foundation
import Observation
import SwiftUI

/// Session-only draft of dashboard layout while the user is editing.
///
/// Hide / show / drop write through to `AppearancePreferences`. In-flight
/// drags mutate `draft` only so Escape can restore the snapshot.
@Observable
@MainActor
final class DashboardLayoutEditor {
	private(set) var draft: DashboardLayout = .empty
	private(set) var draggingID: DashboardBlockID?
	private(set) var isDraggingFromTray = false
	private(set) var dragLocation: CGPoint?

	@ObservationIgnored
	private var dragOrigin: DashboardLayout?
	@ObservationIgnored
	private var escapeMonitor: Any?
	@ObservationIgnored
	private var mouseMonitor: Any?
	@ObservationIgnored
	private var lastWindowPoint: CGPoint?
	@ObservationIgnored
	private var lastSlots: [DashboardSlotFrame] = []
	@ObservationIgnored
	private var lastTrayFrame: CGRect?
	@ObservationIgnored
	private var lastDescriptors: [DashboardBlockDescriptor] = []
	/// Drop persistence is view-owned (writes `AppearancePreferences`).
	@ObservationIgnored
	var onPointerUp: (() -> Void)?

	var isDragging: Bool { draggingID != nil }

	func sync(from layout: DashboardLayout) {
		guard draggingID == nil else { return }
		draft = layout
	}

	func hide(_ id: DashboardBlockID, from descriptors: [DashboardBlockDescriptor]) -> DashboardLayout {
		draft = draft.hiding(id, from: descriptors)
		return draft
	}

	func showAppending(
		_ id: DashboardBlockID,
		from descriptors: [DashboardBlockDescriptor]
	) -> DashboardLayout {
		draft = draft.showing(id, at: nil, from: descriptors)
		return draft
	}

	func beginDrag(id: DashboardBlockID, fromTray: Bool, location: CGPoint) {
		guard draggingID == nil else { return }
		dragOrigin = draft
		draggingID = id
		isDraggingFromTray = fromTray
		dragLocation = location
		lastWindowPoint = nil
		installSessionMonitors()
	}

	func updateDrag(
		location: CGPoint,
		slots: [DashboardSlotFrame],
		trayFrame: CGRect?,
		descriptors: [DashboardBlockDescriptor]
	) {
		guard let draggingID else { return }
		lastSlots = slots
		lastTrayFrame = trayFrame
		lastDescriptors = descriptors
		dragLocation = location

		let isRunner = descriptors.first { $0.id == draggingID }?.isFlowRunner ?? false
		let kindSlots = slots.filter { slot in
			(descriptors.first { $0.id == slot.id }?.isFlowRunner ?? false) == isRunner
		}
		let visible = draft.resolvedVisible(from: descriptors)
		let kindVisible = visible.filter { id in
			(descriptors.first { $0.id == id }?.isFlowRunner ?? false) == isRunner
		}
		let stillInTray = isDraggingFromTray && draft.isHidden(id: draggingID)
		let regionBounds = kindSlots.reduce(CGRect.null) { $0.union($1.frame) }
		let inKindRegion = !regionBounds.isNull
			&& regionBounds.insetBy(dx: -24, dy: -24).contains(location)

		let target = DashboardDragGeometry.targetIndex(
			at: location,
			slots: kindSlots.filter { $0.id != draggingID || !stillInTray },
			visible: kindVisible.filter { $0 != draggingID || !stillInTray },
			trayFrame: trayFrame,
			requireHit: stillInTray || !inKindRegion
		)

		if stillInTray {
			if let trayFrame, trayFrame.contains(location) {
				return
			}
			guard let target else { return }
			let fullIndex = DashboardLayout.visibleIndex(
				forRegionIndex: target,
				draggingID: draggingID,
				visible: draft.resolvedVisible(from: descriptors),
				descriptors: descriptors
			)
			draft = draft.showing(draggingID, at: fullIndex, from: descriptors)
			return
		}

		if isDraggingFromTray, let trayFrame, trayFrame.contains(location) {
			if let origin = dragOrigin {
				draft = origin
			}
			return
		}

		guard inKindRegion, let target else { return }
		let fullIndex = DashboardLayout.visibleIndex(
			forRegionIndex: target,
			draggingID: draggingID,
			visible: draft.resolvedVisible(from: descriptors),
			descriptors: descriptors
		)
		let next = draft.moving(draggingID, to: fullIndex, from: descriptors)
		if next != draft {
			draft = next
		}
	}

	/// Commits the draft when the drop is valid. Returns the layout to persist,
	/// or `nil` when the drag was cancelled / never acquired a target.
	func endDrag(commit: Bool) -> DashboardLayout? {
		defer { clearDrag() }
		guard dragOrigin != nil else { return nil }
		if commit, let draggingID {
			if isDraggingFromTray, draft.isHidden(id: draggingID) {
				draft = dragOrigin ?? draft
				return nil
			}
			return draft
		}
		draft = dragOrigin ?? draft
		return nil
	}

	func cancelDrag() {
		_ = endDrag(commit: false)
	}

	private func clearDrag() {
		draggingID = nil
		isDraggingFromTray = false
		dragLocation = nil
		dragOrigin = nil
		lastWindowPoint = nil
		lastSlots = []
		lastTrayFrame = nil
		lastDescriptors = []
		removeSessionMonitors()
	}

	private func installSessionMonitors() {
		removeSessionMonitors()
		escapeMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
			guard event.keyCode == 53 else { return event }
			Task { @MainActor in
				self?.cancelDrag()
			}
			return nil
		}
		mouseMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) {
			[weak self] event in
			guard let self else { return event }
			if event.type == .leftMouseUp {
				Task { @MainActor in
					self.onPointerUp?()
				}
				return event
			}
			let windowPoint = event.locationInWindow
			Task { @MainActor in
				self.applyWindowDelta(to: windowPoint)
			}
			return event
		}
	}

	private func applyWindowDelta(to windowPoint: CGPoint) {
		defer { lastWindowPoint = windowPoint }
		guard let last = lastWindowPoint, let loc = dragLocation else { return }
		// AppKit window Y grows up; SwiftUI Y grows down.
		let next = CGPoint(
			x: loc.x + (windowPoint.x - last.x),
			y: loc.y - (windowPoint.y - last.y)
		)
		withAnimation(DashboardSectionMotion.animation) {
			updateDrag(
				location: next,
				slots: lastSlots,
				trayFrame: lastTrayFrame,
				descriptors: lastDescriptors
			)
		}
	}

	private func removeSessionMonitors() {
		if let escapeMonitor {
			NSEvent.removeMonitor(escapeMonitor)
		}
		escapeMonitor = nil
		if let mouseMonitor {
			NSEvent.removeMonitor(mouseMonitor)
		}
		mouseMonitor = nil
	}
}
