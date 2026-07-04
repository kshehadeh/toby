import AppKit
import SwiftUI

enum SkillMarkdownFormat {
	case bold
	case italic
	case code
	case list
	case quote
}

/// View-owned controller that bridges the SwiftUI toolbar/footer to the AppKit text view.
@MainActor
final class SkillMarkdownEditorModel: ObservableObject {
	@Published var line: Int = 1
	@Published var column: Int = 1
	fileprivate var applyFormat: ((SkillMarkdownFormat) -> Void)?

	func format(_ format: SkillMarkdownFormat) {
		applyFormat?(format)
	}
}

/// AppKit-backed markdown editor with live syntax highlighting for the skill editor.
struct SkillMarkdownTextView: NSViewRepresentable {
	@Binding var text: String
	let model: SkillMarkdownEditorModel

	func makeNSView(context: Context) -> NSScrollView {
		let textView = SkillMarkdownNSTextView()
		textView.delegate = context.coordinator
		textView.backgroundColor = .clear
		textView.drawsBackground = false
		textView.isRichText = false
		textView.isAutomaticQuoteSubstitutionEnabled = false
		textView.isAutomaticDashSubstitutionEnabled = false
		textView.isAutomaticTextReplacementEnabled = false
		textView.isAutomaticSpellingCorrectionEnabled = false
		textView.allowsUndo = true
		textView.textContainerInset = NSSize(width: 18, height: 16)
		textView.font = SkillMarkdownSyntax.baseFont
		textView.textColor = SkillMarkdownSyntax.primaryColor
		textView.insertionPointColor = SkillMarkdownSyntax.primaryColor
		textView.isVerticallyResizable = true
		textView.isHorizontallyResizable = false
		textView.textContainer?.widthTracksTextView = true
		textView.textContainer?.containerSize = NSSize(
			width: 0,
			height: CGFloat.greatestFiniteMagnitude,
		)
		textView.maxSize = NSSize(
			width: CGFloat.greatestFiniteMagnitude,
			height: CGFloat.greatestFiniteMagnitude,
		)
		textView.string = text
		context.coordinator.textView = textView
		context.coordinator.highlight()
		context.coordinator.updateCursor()

		model.applyFormat = { [weak coordinator = context.coordinator] format in
			coordinator?.applyFormat(format)
		}

		let scrollView = SkillMarkdownScrollView()
		scrollView.documentView = textView
		scrollView.hasVerticalScroller = true
		scrollView.autohidesScrollers = true
		scrollView.drawsBackground = false
		scrollView.resizeDocumentViewToFillContent()
		return scrollView
	}

	func updateNSView(_ nsView: NSScrollView, context: Context) {
		guard let textView = nsView.documentView as? NSTextView else { return }
		if textView.string != text {
			context.coordinator.isUpdating = true
			let selected = textView.selectedRange()
			textView.string = text
			textView.setSelectedRange(
				NSRange(
					location: min(selected.location, (text as NSString).length),
					length: 0,
				),
			)
			context.coordinator.isUpdating = false
			context.coordinator.highlight()
		}
		(nsView as? SkillMarkdownScrollView)?.resizeDocumentViewToFillContent()
	}

	func makeCoordinator() -> Coordinator {
		Coordinator(self)
	}

	@MainActor
	final class Coordinator: NSObject, NSTextViewDelegate {
		let parent: SkillMarkdownTextView
		weak var textView: NSTextView?
		var isUpdating = false

		init(_ parent: SkillMarkdownTextView) {
			self.parent = parent
		}

		func textDidChange(_ notification: Notification) {
			guard !isUpdating, let textView = notification.object as? NSTextView else {
				return
			}
			parent.text = textView.string
			highlight()
			updateCursor()
		}

		func textViewDidChangeSelection(_ notification: Notification) {
			updateCursor()
		}

		func updateCursor() {
			guard let textView else { return }
			let ns = textView.string as NSString
			let location = min(textView.selectedRange().location, ns.length)
			var line = 1
			var lineStart = 0
			var index = 0
			while index < location {
				if ns.character(at: index) == 0x0A {
					line += 1
					lineStart = index + 1
				}
				index += 1
			}
			let column = location - lineStart + 1
			let model = parent.model
			if model.line != line { model.line = line }
			if model.column != column { model.column = column }
		}

		func applyFormat(_ format: SkillMarkdownFormat) {
			guard let textView else { return }
			let ns = textView.string as NSString
			let range = textView.selectedRange()
			switch format {
			case .bold:
				wrap(textView, range: range, marker: "**")
			case .italic:
				wrap(textView, range: range, marker: "*")
			case .code:
				wrap(textView, range: range, marker: "`")
			case .list:
				prefixLine(textView, ns: ns, range: range, prefix: "- ")
			case .quote:
				prefixLine(textView, ns: ns, range: range, prefix: "> ")
			}
			parent.text = textView.string
			highlight()
			updateCursor()
		}

		private func wrap(_ textView: NSTextView, range: NSRange, marker: String) {
			let ns = textView.string as NSString
			let selected = ns.substring(with: range)
			let replacement = "\(marker)\(selected)\(marker)"
			if textView.shouldChangeText(in: range, replacementString: replacement) {
				textView.textStorage?.replaceCharacters(in: range, with: replacement)
				textView.didChangeText()
				let caret = selected.isEmpty
					? range.location + (marker as NSString).length
					: range.location + (replacement as NSString).length
				textView.setSelectedRange(NSRange(location: caret, length: 0))
			}
		}

		private func prefixLine(
			_ textView: NSTextView,
			ns: NSString,
			range: NSRange,
			prefix: String,
		) {
			let lineRange = ns.lineRange(for: NSRange(location: range.location, length: 0))
			let insertRange = NSRange(location: lineRange.location, length: 0)
			if textView.shouldChangeText(in: insertRange, replacementString: prefix) {
				textView.textStorage?.replaceCharacters(in: insertRange, with: prefix)
				textView.didChangeText()
				textView.setSelectedRange(
					NSRange(location: range.location + (prefix as NSString).length, length: 0),
				)
			}
		}

		func highlight() {
			guard let textView, let storage = textView.textStorage else { return }
			SkillMarkdownSyntax.apply(to: storage)
		}
	}
}

final class SkillMarkdownNSTextView: NSTextView {
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

final class SkillMarkdownScrollView: NSScrollView {
	override func layout() {
		super.layout()
		resizeDocumentViewToFillContent()
	}

	func resizeDocumentViewToFillContent() {
		guard let textView = documentView as? NSTextView else { return }
		let visibleSize = contentSize
		textView.minSize = NSSize(width: 0, height: visibleSize.height)
		textView.maxSize = NSSize(
			width: CGFloat.greatestFiniteMagnitude,
			height: CGFloat.greatestFiniteMagnitude,
		)
		textView.textContainer?.containerSize = NSSize(
			width: visibleSize.width,
			height: CGFloat.greatestFiniteMagnitude,
		)
		textView.textContainer?.widthTracksTextView = true

		var frame = textView.frame
		let targetWidth = max(frame.width, visibleSize.width)
		let targetHeight = max(frame.height, visibleSize.height)
		if frame.width != targetWidth || frame.height != targetHeight {
			frame.size = NSSize(width: targetWidth, height: targetHeight)
			textView.frame = frame
		}
	}
}
