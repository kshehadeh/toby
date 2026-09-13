import SwiftUI

/// Whether the transcript should keep pinning to the latest content.
///
/// `onScrollGeometryChange` fires for layout as well as user scrolling. A new
/// prompt or streaming token grows `contentHeight` while `contentOffset` stays
/// put, which looks "not near the bottom" even though the user never scrolled.
/// Follow mode is cleared only when the offset moves up (the user scrolled
/// back); returning to the bottom re-attaches.
enum TranscriptScrollFollow {
	/// Distance from the true bottom that still counts as following.
	static let bottomThreshold: CGFloat = 120
	/// Ignore sub-threshold offset jitter from layout so we only detach on a
	/// real upward scroll.
	static let userScrollUpThreshold: CGFloat = 8

	struct Geometry: Equatable {
		var offsetY: CGFloat
		var containerHeight: CGFloat
		var contentHeight: CGFloat
		var visibleMaxY: CGFloat

		var isNearBottom: Bool {
			contentHeight <= containerHeight + 1
				|| visibleMaxY >= contentHeight - TranscriptScrollFollow.bottomThreshold
		}

		init(
			offsetY: CGFloat,
			containerHeight: CGFloat,
			contentHeight: CGFloat,
			visibleMaxY: CGFloat? = nil,
		) {
			self.offsetY = offsetY
			self.containerHeight = containerHeight
			self.contentHeight = contentHeight
			self.visibleMaxY = visibleMaxY ?? offsetY + containerHeight
		}

		init(_ geometry: ScrollGeometry) {
			self.init(
				offsetY: geometry.contentOffset.y,
				containerHeight: geometry.containerSize.height,
				contentHeight: geometry.contentSize.height,
				visibleMaxY: geometry.visibleRect.maxY,
			)
		}
	}

	static func shouldFollow(
		currentlyFollowing: Bool,
		previous: Geometry,
		current: Geometry,
	) -> Bool {
		if current.isNearBottom { return true }
		let scrolledUp = current.offsetY < previous.offsetY - userScrollUpThreshold
		if scrolledUp { return false }
		return currentlyFollowing
	}
}

/// Keeps ``TranscriptView`` follow-mode in sync with scroll geometry.
struct TranscriptBottomFollowTracker: ViewModifier {
	@Binding var isFollowingBottom: Bool

	func body(content: Content) -> some View {
		content.onScrollGeometryChange(for: TranscriptScrollFollow.Geometry.self) { geometry in
			TranscriptScrollFollow.Geometry(geometry)
		} action: { previous, current in
			let next = TranscriptScrollFollow.shouldFollow(
				currentlyFollowing: isFollowingBottom,
				previous: previous,
				current: current,
			)
			if next != isFollowingBottom {
				isFollowingBottom = next
			}
		}
	}
}
