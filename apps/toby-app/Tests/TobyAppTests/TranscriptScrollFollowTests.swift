import Foundation
import Testing
@testable import TobyApp

@Suite("TranscriptScrollFollow")
struct TranscriptScrollFollowTests {
	private let viewport: CGFloat = 600

	@Test("content that still fits the viewport is near the bottom")
	func shortContentIsNearBottom() {
		let geometry = TranscriptScrollFollow.Geometry(
			offsetY: 0,
			containerHeight: viewport,
			contentHeight: 400,
		)
		#expect(geometry.isNearBottom)
	}

	@Test("visible max within the threshold is near the bottom")
	func withinThresholdIsNearBottom() {
		let geometry = TranscriptScrollFollow.Geometry(
			offsetY: 880,
			containerHeight: viewport,
			contentHeight: 1600,
			visibleMaxY: 1480,
		)
		#expect(geometry.isNearBottom)
	}

	@Test("visible max beyond the threshold is not near the bottom")
	func beyondThresholdIsNotNearBottom() {
		let geometry = TranscriptScrollFollow.Geometry(
			offsetY: 0,
			containerHeight: viewport,
			contentHeight: 1600,
			visibleMaxY: 600,
		)
		#expect(!geometry.isNearBottom)
	}

	@Test("near the bottom always re-attaches follow mode")
	func nearBottomReattaches() {
		let previous = TranscriptScrollFollow.Geometry(
			offsetY: 0,
			containerHeight: viewport,
			contentHeight: 2000,
		)
		let current = TranscriptScrollFollow.Geometry(
			offsetY: 1400,
			containerHeight: viewport,
			contentHeight: 2000,
			visibleMaxY: 2000,
		)
		#expect(
			TranscriptScrollFollow.shouldFollow(
				currentlyFollowing: false,
				previous: previous,
				current: current,
			)
		)
	}

	@Test("content growth while following keeps follow mode")
	func contentGrowthKeepsFollowing() {
		// Pinned at the bottom, then a new prompt / stream grows the transcript
		// by more than the near-bottom threshold without a user scroll.
		let previous = TranscriptScrollFollow.Geometry(
			offsetY: 1000,
			containerHeight: viewport,
			contentHeight: 1600,
			visibleMaxY: 1600,
		)
		let current = TranscriptScrollFollow.Geometry(
			offsetY: 1000,
			containerHeight: viewport,
			contentHeight: 2200,
			visibleMaxY: 1600,
		)
		#expect(!current.isNearBottom)
		#expect(
			TranscriptScrollFollow.shouldFollow(
				currentlyFollowing: true,
				previous: previous,
				current: current,
			)
		)
	}

	@Test("content growth while scrolled up stays detached")
	func contentGrowthWhileDetachedStaysDetached() {
		let previous = TranscriptScrollFollow.Geometry(
			offsetY: 200,
			containerHeight: viewport,
			contentHeight: 1600,
			visibleMaxY: 800,
		)
		let current = TranscriptScrollFollow.Geometry(
			offsetY: 200,
			containerHeight: viewport,
			contentHeight: 2200,
			visibleMaxY: 800,
		)
		#expect(
			!TranscriptScrollFollow.shouldFollow(
				currentlyFollowing: false,
				previous: previous,
				current: current,
			)
		)
	}

	@Test("scrolling up detaches follow mode")
	func scrollingUpDetaches() {
		let previous = TranscriptScrollFollow.Geometry(
			offsetY: 1000,
			containerHeight: viewport,
			contentHeight: 2200,
			visibleMaxY: 1600,
		)
		let current = TranscriptScrollFollow.Geometry(
			offsetY: 700,
			containerHeight: viewport,
			contentHeight: 2200,
			visibleMaxY: 1300,
		)
		#expect(
			!TranscriptScrollFollow.shouldFollow(
				currentlyFollowing: true,
				previous: previous,
				current: current,
			)
		)
	}

	@Test("scrolling up during content growth still detaches")
	func scrollingUpDuringGrowthDetaches() {
		let previous = TranscriptScrollFollow.Geometry(
			offsetY: 1000,
			containerHeight: viewport,
			contentHeight: 1600,
			visibleMaxY: 1600,
		)
		let current = TranscriptScrollFollow.Geometry(
			offsetY: 700,
			containerHeight: viewport,
			contentHeight: 2200,
			visibleMaxY: 1300,
		)
		#expect(
			!TranscriptScrollFollow.shouldFollow(
				currentlyFollowing: true,
				previous: previous,
				current: current,
			)
		)
	}

	@Test("sub-threshold offset jitter does not detach")
	func layoutJitterDoesNotDetach() {
		let previous = TranscriptScrollFollow.Geometry(
			offsetY: 1000,
			containerHeight: viewport,
			contentHeight: 2200,
			visibleMaxY: 1600,
		)
		let current = TranscriptScrollFollow.Geometry(
			offsetY: 996,
			containerHeight: viewport,
			contentHeight: 2200,
			visibleMaxY: 1596,
		)
		#expect(
			TranscriptScrollFollow.shouldFollow(
				currentlyFollowing: true,
				previous: previous,
				current: current,
			)
		)
	}

	@Test("initial layout of a tall transcript stays following")
	func initialTallLayoutStaysFollowing() {
		let previous = TranscriptScrollFollow.Geometry(
			offsetY: 0,
			containerHeight: 0,
			contentHeight: 0,
		)
		let current = TranscriptScrollFollow.Geometry(
			offsetY: 0,
			containerHeight: viewport,
			contentHeight: 2000,
			visibleMaxY: 600,
		)
		#expect(
			TranscriptScrollFollow.shouldFollow(
				currentlyFollowing: true,
				previous: previous,
				current: current,
			)
		)
	}
}
