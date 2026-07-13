import AppKit
import SwiftUI

extension View {
	/// Native scroll indicators that appear only while the user is scrolling.
	///
	/// Applies ``View/scrollIndicators(_:axes:)`` with `.automatic`, then configures
	/// the underlying `NSScrollView` to use the AppKit **overlay** scroller style
	/// with autohide enabled. Without that, macOS SwiftUI often keeps a permanent
	/// legacy scroller whenever content overflows (especially with a mouse), which
	/// is not the “show only while scrolling” convention described for automatic
	/// indicators.
	func automaticScrollIndicators(axes: Axis.Set = [.vertical, .horizontal]) -> some View {
		self
			.scrollIndicators(.automatic, axes: axes)
			.background(alignment: .topLeading) {
				ScrollViewOverlayStyleInstaller()
					.frame(width: 0, height: 0)
					.allowsHitTesting(false)
					.accessibilityHidden(true)
			}
	}
}

/// Finds the hosting `NSScrollView` and switches it to overlay / autohide scrollers.
private struct ScrollViewOverlayStyleInstaller: NSViewRepresentable {
	func makeNSView(context: Context) -> InstallerView {
		InstallerView()
	}

	func updateNSView(_ nsView: InstallerView, context: Context) {
		nsView.installIfNeeded()
	}

	final class InstallerView: NSView {
		override func viewDidMoveToWindow() {
			super.viewDidMoveToWindow()
			// Hierarchy is often finalized after the first layout pass.
			DispatchQueue.main.async { [weak self] in
				self?.installIfNeeded()
			}
		}

		override func viewDidMoveToSuperview() {
			super.viewDidMoveToSuperview()
			DispatchQueue.main.async { [weak self] in
				self?.installIfNeeded()
			}
		}

		override func layout() {
			super.layout()
			installIfNeeded()
		}

		func installIfNeeded() {
			guard let scrollView = findScrollView() else { return }
			if scrollView.scrollerStyle != .overlay {
				scrollView.scrollerStyle = .overlay
			}
			if !scrollView.autohidesScrollers {
				scrollView.autohidesScrollers = true
			}
		}

		private func findScrollView() -> NSScrollView? {
			if let scrollView = enclosingScrollView {
				return scrollView
			}

			// Walk ancestors (SwiftUI may nest the representable outside the clip view).
			// Prefer the nearest NSScrollView so nested scrollers are not mis-targeted.
			var ancestor: NSView? = superview
			while let current = ancestor {
				if let scrollView = current as? NSScrollView {
					return scrollView
				}
				if let scrollView = current.subviews.compactMap({ $0 as? NSScrollView }).first {
					return scrollView
				}
				// Common SwiftUI hosting: NSScrollView is a descendant of a nearby ancestor.
				if let nested = firstScrollView(in: current, depth: 0, maxDepth: 4) {
					return nested
				}
				ancestor = current.superview
			}
			return nil
		}

		private func firstScrollView(in root: NSView, depth: Int, maxDepth: Int) -> NSScrollView? {
			if depth > maxDepth { return nil }
			if let scrollView = root as? NSScrollView { return scrollView }
			for subview in root.subviews {
				if let found = firstScrollView(in: subview, depth: depth + 1, maxDepth: maxDepth) {
					return found
				}
			}
			return nil
		}
	}
}
