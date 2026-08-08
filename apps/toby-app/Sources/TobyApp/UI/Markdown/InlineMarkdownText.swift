import Foundation
import SwiftUI

struct InlineMarkdownText: View {
	let text: String
	/// Base color for normal (non-bold) runs. When set, colors are applied on the attributed string.
	var baseForeground: Color? = nil
	/// Color for bold/strong runs. Defaults to `baseForeground` when only base is set.
	var strongForeground: Color? = nil

	/// Collapsed dashboard cards set this to `false` so text selection cannot
	/// expand/reflow a single markdown sub-block inside a fixed-height clip.
	@Environment(\.dashboardCardBodyInteractive) private var bodyInteractive

	var body: some View {
		if let attributed = Self.makeAttributed(
			text: text,
			baseForeground: baseForeground,
			strongForeground: strongForeground,
		) {
			selectableText(Text(attributed))
		} else if let baseForeground {
			selectableText(Text(text).foregroundStyle(baseForeground))
		} else {
			selectableText(Text(text))
		}
	}

	@ViewBuilder
	private func selectableText<Content: View>(_ content: Content) -> some View {
		if bodyInteractive {
			content.textSelection(.enabled)
		} else {
			content.textSelection(.disabled)
		}
	}
}

// MARK: - Parsing cache

private enum InlineMarkdownCache {
	/// Process-wide parse cache. NSCache is thread-safe; marked unsafe for Swift 6
	/// static isolation checks only.
	nonisolated(unsafe) static let store = NSCache<NSString, CachedInlineMarkdown>()

	final class CachedInlineMarkdown: NSObject {
		let attributed: AttributedString
		init(_ attributed: AttributedString) {
			self.attributed = attributed
			super.init()
		}
	}
}

extension InlineMarkdownText {
	static func makeAttributed(
		text: String,
		baseForeground: Color?,
		strongForeground: Color?,
	) -> AttributedString? {
		let key =
			"\(text.count)|\(text.hashValue)|\(baseForeground != nil)|\(strongForeground != nil)"
			as NSString
		if let hit = InlineMarkdownCache.store.object(forKey: key) {
			return hit.attributed
		}

		guard var attributed = try? AttributedString(
			markdown: text,
			options: AttributedString.MarkdownParsingOptions(
				interpretedSyntax: .inlineOnlyPreservingWhitespace,
				failurePolicy: .returnPartiallyParsedIfPossible,
			),
		) else {
			return nil
		}

		if baseForeground != nil || strongForeground != nil {
			let base = baseForeground ?? strongForeground!
			let strong = strongForeground ?? base
			for run in attributed.runs {
				let isStrong = run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true
				attributed[run.range].foregroundColor = isStrong ? strong : base
			}
		}

		InlineMarkdownCache.store.setObject(
			InlineMarkdownCache.CachedInlineMarkdown(attributed),
			forKey: key,
		)
		return attributed
	}
}

extension Array {
	subscript(safe index: Int) -> Element? {
		indices.contains(index) ? self[index] : nil
	}
}

extension TextAlignment {
	var alignment: Alignment {
		switch self {
		case .leading: return .leading
		case .center: return .center
		case .trailing: return .trailing
		@unknown default: return .leading
		}
	}

	var unitPoint: UnitPoint {
		switch self {
		case .leading: return .topLeading
		case .center: return .top
		case .trailing: return .topTrailing
		@unknown default: return .topLeading
		}
	}

	var zstackAlignment: Alignment {
		switch self {
		case .leading: return .topLeading
		case .center: return .top
		case .trailing: return .topTrailing
		@unknown default: return .topLeading
		}
	}
}
