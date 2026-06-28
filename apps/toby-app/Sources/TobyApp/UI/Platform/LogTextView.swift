import AppKit
import SwiftUI
import STTextView

struct LogTextView: NSViewRepresentable {
	let text: String

	func makeCoordinator() -> Coordinator {
		Coordinator()
	}

	func makeNSView(context: Context) -> NSScrollView {
		let scrollView = STTextView.scrollableTextView()
		scrollView.hasVerticalScroller = true
		scrollView.hasHorizontalScroller = false
		scrollView.autohidesScrollers = false
		scrollView.drawsBackground = true
		scrollView.backgroundColor = NSColor(red: 0.08, green: 0.08, blue: 0.09, alpha: 1.0)
		scrollView.contentView.drawsBackground = true
		scrollView.contentView.backgroundColor = NSColor(red: 0.08, green: 0.08, blue: 0.09, alpha: 1.0)

		guard let textView = scrollView.documentView as? STTextView else {
			return scrollView
		}
		textView.showsLineNumbers = true
		textView.isEditable = false
		textView.isSelectable = true
		textView.isHorizontallyResizable = false
		textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
		textView.textColor = NSColor.white.withAlphaComponent(0.88)
		textView.backgroundColor = NSColor(red: 0.08, green: 0.08, blue: 0.09, alpha: 1.0)

		return scrollView
	}

	func updateNSView(_ scrollView: NSScrollView, context: Context) {
		guard let textView = scrollView.documentView as? STTextView else { return }
		if textView.text != text {
			let shouldAutoScroll = context.coordinator.hasReceivedContent && isScrolledToBottom(scrollView)
			textView.text = text
			textView.needsLayout = true
			textView.needsDisplay = true
			context.coordinator.hasReceivedContent = true
			if shouldAutoScroll {
				DispatchQueue.main.async {
					self.scrollToBottomIfValid(scrollView)
				}
			}
		}
	}

	private func isScrolledToBottom(_ scrollView: NSScrollView) -> Bool {
		let visibleRect = scrollView.contentView.visibleRect
		let documentRect = scrollView.documentView?.bounds ?? .zero
		guard documentRect.height > visibleRect.height + 2 else { return false }
		return visibleRect.maxY >= documentRect.maxY - 2
	}

	private func scrollToBottomIfValid(_ scrollView: NSScrollView) {
		let documentRect = scrollView.documentView?.bounds ?? .zero
		guard documentRect.height > 0 else { return }
		let maxY = documentRect.maxY - scrollView.contentView.bounds.height
		let targetY = max(0, maxY)
		scrollView.contentView.scroll(to: CGPoint(x: 0, y: targetY))
		scrollView.reflectScrolledClipView(scrollView.contentView)
	}

	final class Coordinator {
		var hasReceivedContent = false
	}
}
