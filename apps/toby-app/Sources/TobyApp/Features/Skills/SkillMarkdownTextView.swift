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

/// AppKit-backed markdown editor. Text appearance is left to a stock NSTextView
/// (user fixed-pitch font, system text color, default caret and line height).
struct SkillMarkdownTextView: NSViewRepresentable {
	@Binding var text: String
	let model: SkillMarkdownEditorModel

	/// Stable height when SwiftUI offers an unbounded proposal (e.g. nested in a
	/// `ScrollView`). Without this, the document view’s content height feeds back
	/// into layout and freezes the app on repeated select/deselect.
	static let fallbackHeight: CGFloat = 480

	/// System fixed-pitch font at the default size — the stock coding-editor face,
	/// not a custom markdown palette or line-height.
	static var editorFont: NSFont {
		NSFont.userFixedPitchFont(ofSize: 0)
			?? NSFont.monospacedSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
	}

	func sizeThatFits(
		_ proposal: ProposedViewSize,
		nsView: NSScrollView,
		context: Context,
	) -> CGSize? {
		let width = Self.resolvedDimension(proposal.width, fallback: 400)
		let height = Self.resolvedDimension(proposal.height, fallback: Self.fallbackHeight)
		return CGSize(width: width, height: height)
	}

	private static func resolvedDimension(_ proposed: CGFloat?, fallback: CGFloat) -> CGFloat {
		guard let proposed, proposed.isFinite, proposed > 0 else { return fallback }
		return proposed
	}

	func makeNSView(context: Context) -> NSScrollView {
		// Give AppKit a finite viewport before assigning text.
		// A zero-width text container can explode glyph layout for long skills.
		let scrollView = NSScrollView(
			frame: NSRect(x: 0, y: 0, width: 400, height: Self.fallbackHeight)
		)
		scrollView.hasVerticalScroller = true
		scrollView.autohidesScrollers = true
		scrollView.drawsBackground = false

		let viewport = scrollView.contentSize
		let textView = SkillMarkdownNSTextView(
			frame: NSRect(origin: .zero, size: viewport)
		)
		textView.delegate = context.coordinator
		textView.backgroundColor = .clear
		textView.drawsBackground = false
		textView.isEditable = true
		textView.isSelectable = true
		textView.isRichText = false
		textView.isAutomaticQuoteSubstitutionEnabled = false
		textView.isAutomaticDashSubstitutionEnabled = false
		textView.isAutomaticTextReplacementEnabled = false
		textView.isAutomaticSpellingCorrectionEnabled = false
		textView.allowsUndo = true
		textView.textContainerInset = NSSize(width: 18, height: 16)
		textView.font = Self.editorFont
		textView.textColor = .textColor
		textView.isVerticallyResizable = true
		textView.isHorizontallyResizable = false
		textView.autoresizingMask = [.width]
		textView.minSize = NSSize(width: 0, height: viewport.height)
		textView.maxSize = NSSize(
			width: CGFloat.greatestFiniteMagnitude,
			height: CGFloat.greatestFiniteMagnitude,
		)
		textView.textContainer?.widthTracksTextView = true
		textView.textContainer?.containerSize = NSSize(
			width: viewport.width,
			height: CGFloat.greatestFiniteMagnitude,
		)
		scrollView.documentView = textView

		textView.string = text
		context.coordinator.textView = textView
		context.coordinator.updateCursor()

		let applyFormat: (SkillMarkdownFormat) -> Void = { [weak coordinator = context.coordinator] format in
			coordinator?.applyFormat(format)
		}
		model.applyFormat = applyFormat
		textView.onFormat = applyFormat
		return scrollView
	}

	func updateNSView(_ nsView: NSScrollView, context: Context) {
		guard let textView = nsView.documentView as? SkillMarkdownNSTextView else { return }
		guard !context.coordinator.isDismantled else { return }
		context.coordinator.parent = self
		let applyFormat: (SkillMarkdownFormat) -> Void = { [weak coordinator = context.coordinator] format in
			coordinator?.applyFormat(format)
		}
		model.applyFormat = applyFormat
		textView.onFormat = applyFormat
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
		}
		textView.isEditable = true
		textView.isSelectable = true
		textView.font = Self.editorFont
		textView.textColor = .textColor
	}

	func makeCoordinator() -> Coordinator {
		Coordinator(self)
	}

	static func dismantleNSView(_ nsView: NSScrollView, coordinator: Coordinator) {
		coordinator.prepareForDismantle()
		if let textView = nsView.documentView as? SkillMarkdownNSTextView {
			if textView.window?.firstResponder === textView {
				textView.window?.makeFirstResponder(nil)
			}
			textView.delegate = nil
			textView.onFormat = nil
		}
		nsView.documentView = nil
	}

	@MainActor
	final class Coordinator: NSObject, NSTextViewDelegate {
		var parent: SkillMarkdownTextView
		weak var textView: NSTextView?
		var isUpdating = false
		var isDismantled = false

		init(_ parent: SkillMarkdownTextView) {
			self.parent = parent
		}

		func prepareForDismantle() {
			isDismantled = true
			isUpdating = true
			textView?.delegate = nil
			textView = nil
			parent.model.applyFormat = nil
		}

		func textDidChange(_ notification: Notification) {
			guard !isDismantled, !isUpdating, let textView = notification.object as? NSTextView else {
				return
			}
			parent.text = textView.string
			updateCursor()
		}

		func textViewDidChangeSelection(_ notification: Notification) {
			guard !isDismantled else { return }
			updateCursor()
		}

		func updateCursor() {
			guard !isDismantled, let textView else { return }
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
	}
}

/// Thin NSTextView subclass: tab traversal + markdown format key equivalents.
/// Caret size, blink, and drawing are left entirely to AppKit.
final class SkillMarkdownNSTextView: NSTextView {
	/// Called for toolbar actions and keyboard shortcuts (⌘B / ⌘I).
	var onFormat: ((SkillMarkdownFormat) -> Void)?

	override func performKeyEquivalent(with event: NSEvent) -> Bool {
		// Only ⌘ (not ⌘⇧ / ⌘⌥ / etc.). Ignore caps lock and other noise flags.
		let mods = event.modifierFlags.intersection([.command, .shift, .option, .control])
		guard isEditable,
			event.type == .keyDown,
			mods == .command,
			let chars = event.charactersIgnoringModifiers?.lowercased(),
			let format = Self.format(forCommandKey: chars)
		else {
			return super.performKeyEquivalent(with: event)
		}
		onFormat?(format)
		return true
	}

	/// Maps plain ⌘+letter shortcuts to markdown formats. Internal for tests.
	static func format(forCommandKey chars: String) -> SkillMarkdownFormat? {
		switch chars.lowercased() {
		case "b": return .bold
		case "i": return .italic
		default: return nil
		}
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
