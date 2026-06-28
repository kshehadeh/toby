import SwiftUI
import AppKit

/// A hidden view that, when placed inside a SwiftUI `ScrollView`, detects
/// scrolling on the underlying AppKit `NSScrollView`. It reports whether the
/// user is actively scrolling so the caller can show/hide a custom scrollbar
/// indicator.
struct ScrollStateTracker: NSViewRepresentable {
	@Binding var isScrolling: Bool
	@Binding var progress: CGFloat

	func makeNSView(context: Context) -> NSView {
		ScrollStateTrackerView()
	}

	func updateNSView(_ nsView: NSView, context: Context) {
		guard let tracker = nsView as? ScrollStateTrackerView else { return }
		tracker.onScroll = { [self] scrolling in
			isScrolling = scrolling
		}
		tracker.onProgress = { [self] progress in
			self.progress = progress
		}
	}
}

func clampedScrollProgress(contentHeight: CGFloat, visibleHeight: CGFloat, offset: CGFloat) -> CGFloat {
	let maxOffset = max(contentHeight - visibleHeight, 0)
	guard maxOffset > 0 else { return 0 }
	return min(max(offset / maxOffset, 0), 1)
}

@MainActor
private final class ScrollStateTrackerView: NSView {
	var onScroll: (@MainActor (Bool) -> Void)?
	var onProgress: (@MainActor (CGFloat) -> Void)?
	private var observation: NSObjectProtocol?
	private var hideTimer: Timer?

	override func viewDidMoveToWindow() {
		super.viewDidMoveToWindow()
		startObserving()
	}

	override func viewDidMoveToSuperview() {
		super.viewDidMoveToSuperview()
		startObserving()
	}

	override func layout() {
		super.layout()
		startObserving()
	}

	override func removeFromSuperview() {
		stopObserving()
		super.removeFromSuperview()
	}

	private func startObserving() {
		guard observation == nil, let scrollView = findScrollView() else { return }
		let clipView = scrollView.contentView
		observation = NotificationCenter.default.addObserver(
			forName: NSView.boundsDidChangeNotification,
			object: clipView,
			queue: .main
		) { [weak self] _ in
			Task { @MainActor in
				self?.reportScrolling()
			}
		}
		updateProgress()
	}

	private func stopObserving() {
		if let observation = observation {
			NotificationCenter.default.removeObserver(observation)
			self.observation = nil
		}
		hideTimer?.invalidate()
		hideTimer = nil
	}

	private func reportScrolling() {
		onScroll?(true)
		updateProgress()
		hideTimer?.invalidate()
		hideTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: false) { [weak self] _ in
			Task { @MainActor in
				self?.onScroll?(false)
			}
		}
	}

	private func updateProgress() {
		guard let scrollView = findScrollView(),
			let documentView = scrollView.documentView else { return }
		let progress = clampedScrollProgress(
			contentHeight: documentView.frame.height,
			visibleHeight: scrollView.contentView.bounds.height,
			offset: scrollView.contentView.bounds.origin.y
		)
		onProgress?(progress)
	}

	private func findScrollView() -> NSScrollView? {
		if let scrollView = enclosingScrollView {
			return scrollView
		}

		guard let window = self.window else { return nil }
		var result: NSScrollView?
		func scan(_ candidate: NSView) {
			if let scrollView = candidate as? NSScrollView,
				let documentView = scrollView.documentView,
				contains(self, in: documentView) {
				result = scrollView
				return
			}
			for subview in candidate.subviews {
				scan(subview)
			}
		}
		if let contentView = window.contentView {
			scan(contentView)
		}
		return result
	}

	private func contains(_ view: NSView, in ancestor: NSView) -> Bool {
		var current: NSView? = view
		while let candidate = current {
			if candidate == ancestor { return true }
			current = candidate.superview
		}
		return false
	}
}
