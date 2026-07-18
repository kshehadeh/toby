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
		if let attributed = styledAttributed {
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

	private var styledAttributed: AttributedString? {
		guard var attributed = try? AttributedString(
			markdown: text,
			options: AttributedString.MarkdownParsingOptions(
				interpretedSyntax: .inlineOnlyPreservingWhitespace,
				failurePolicy: .returnPartiallyParsedIfPossible,
			),
		) else {
			return nil
		}

		guard baseForeground != nil || strongForeground != nil else {
			return attributed
		}

		let base = baseForeground ?? strongForeground!
		let strong = strongForeground ?? base

		for run in attributed.runs {
			let isStrong = run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true
			attributed[run.range].foregroundColor = isStrong ? strong : base
		}
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
