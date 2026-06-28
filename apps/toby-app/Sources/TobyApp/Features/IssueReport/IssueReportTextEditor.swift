import AppKit
import SwiftUI

struct IssueReportTextEditor: NSViewRepresentable {
	@Binding var text: String
	let maxLength: Int
	let onSubmit: () -> Void

	func makeNSView(context: Context) -> NSScrollView {
		let textView = IssueReportTextView()
		textView.onSubmit = onSubmit
		textView.maxLength = maxLength
		textView.delegate = context.coordinator
		textView.backgroundColor = .clear
		textView.isRichText = false
		textView.isAutomaticQuoteSubstitutionEnabled = false
		textView.isAutomaticDashSubstitutionEnabled = false
		textView.font = NSFont.systemFont(ofSize: NSFont.systemFontSize)
		textView.textColor = NSColor.textColor
		textView.isVerticallyResizable = true
		textView.isHorizontallyResizable = false
		textView.textContainer?.widthTracksTextView = true
		textView.textContainer?.containerSize = NSSize(width: 10000000, height: 10000000)
		textView.maxSize = NSSize(width: 10000000, height: 10000000)

		let scrollView = NSScrollView()
		scrollView.documentView = textView
		scrollView.hasVerticalScroller = true
		scrollView.autohidesScrollers = true
		scrollView.drawsBackground = false

		return scrollView
	}

	func updateNSView(_ nsView: NSScrollView, context: Context) {
		guard let textView = nsView.documentView as? NSTextView else { return }
		if textView.string != text {
			context.coordinator.isUpdating = true
			textView.string = text
			context.coordinator.isUpdating = false
		}
	}

	func makeCoordinator() -> Coordinator {
		Coordinator(self)
	}

	final class Coordinator: NSObject, NSTextViewDelegate {
		let parent: IssueReportTextEditor
		var isUpdating = false

		init(_ parent: IssueReportTextEditor) {
			self.parent = parent
		}

		func textDidChange(_ notification: Notification) {
			guard !isUpdating else { return }
			guard let textView = notification.object as? NSTextView else { return }
			let current = textView.string
			if current.count > parent.maxLength {
				let trimmed = String(current.prefix(parent.maxLength))
				parent.text = trimmed
			} else {
				parent.text = current
			}
		}
	}
}

final class IssueReportTextView: NSTextView {
	var maxLength = Int.max
	var onSubmit: (() -> Void)?

	override func keyDown(with event: NSEvent) {
		let isCommandReturn = event.modifierFlags.contains(.command) &&
			(event.keyCode == 36 || event.keyCode == 76)
		if isCommandReturn {
			onSubmit?()
			return
		}
		super.keyDown(with: event)
	}

	override func doCommand(by selector: Selector) {
		switch selector {
		case #selector(insertTab(_:)):
			window?.selectNextKeyView(nil)
		case #selector(insertBacktab(_:)):
			window?.selectPreviousKeyView(nil)
		default:
			super.doCommand(by: selector)
		}
	}
}
