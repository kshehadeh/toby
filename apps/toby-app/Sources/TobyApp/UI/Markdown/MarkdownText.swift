import SwiftUI

struct MarkdownText: View {
	let text: String
	let font: Font
	let foregroundStyle: Color
	/// When set, bold/strong inline runs use this color while normal text uses `foregroundStyle`.
	var strongForegroundStyle: Color? = nil
	/// Heading color. Defaults to `foregroundStyle` (or primary when using standard styling).
	var headingForegroundStyle: Color? = nil
	/// When true, heading text is rendered in uppercase.
	var uppercaseHeadings: Bool = false
	/// Applies prose typography to headings while keeping tables and code as chrome.
	var usesProseTypography: Bool = false

	/// Collapsed dashboard cards disable body interaction so sub-blocks cannot
	/// expand/reflow clipped text; only the card’s “Show more” grows layout.
	@Environment(\.dashboardCardBodyInteractive) private var bodyInteractive

	/// Parsed blocks for the last `text` value. Avoid re-splitting long assistant
	/// replies on every parent invalidation (scroll, work-chip ticks, etc.).
	@State private var cachedText: String?
	@State private var cachedBlocks: [MarkdownBlock] = []

	var body: some View {
		// Give long-form assistant prose room to breathe between blocks while
		// preserving the denser rhythm used by compact cards and metadata.
		VStack(alignment: .leading, spacing: usesProseTypography ? 8 : (uppercaseHeadings ? 5 : 4)) {
			ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
				switch block {
				case .heading(let level, let content):
					let isSectionLabel = usesProseTypography && level >= 3
					let display = uppercaseHeadings || isSectionLabel ? content.uppercased() : content
					let headingColor = isSectionLabel
						? AppTheme.accent
						: (headingForegroundStyle ?? AppTheme.primaryText)
					inlineText(display, base: headingColor, strong: headingColor)
						.font(headingFont(for: level))
						.fontWeight(.semibold)
						.tracking(headingTracking(for: level))
						.padding(.top, index == 0 ? 0 : headingTopSpacing(for: level))
				case .paragraph(let content):
					styledInline(content)
						.font(font)
				case .bullet(let content):
					HStack(alignment: .firstTextBaseline, spacing: 6) {
						Text("•")
							.font(font)
							.foregroundStyle(foregroundStyle)
						styledInline(content)
							.font(font)
					}
				case .orderedStep(let number, let content):
					HStack(alignment: .top, spacing: 8) {
						Text("\(number)")
							.font(.system(size: 10, weight: .semibold, design: .rounded))
							.monospacedDigit()
							.foregroundStyle(AppTheme.accent)
							.frame(width: 20, height: 20)
							.background(
								Circle()
									.fill(AppTheme.accent.opacity(0.12))
							)
							.frame(width: 22, alignment: .leading)
						styledInline(content)
							.font(font)
							.frame(maxWidth: .infinity, alignment: .leading)
					}
				case .blockquote(let content):
					HStack(alignment: .top, spacing: 8) {
						RoundedRectangle(cornerRadius: 1.5)
							.fill(AppTheme.separator)
							.frame(width: 3)
						styledInline(content, baseOpacity: 0.88)
							.font(font)
					}
					.accessibilityIdentifier("markdown-blockquote")
				case .horizontalRule:
					Divider()
						.overlay(AppTheme.separator)
						.padding(.vertical, 2)
						.accessibilityIdentifier("markdown-horizontal-rule")
				case .code(let content):
					ScrollView(.horizontal, showsIndicators: false) {
						let codeText = Text(content)
							.font(.system(.callout, design: .monospaced))
							.foregroundStyle(foregroundStyle)
						if bodyInteractive {
							codeText.textSelection(.enabled)
						} else {
							codeText.textSelection(.disabled)
						}
					}
				case .table(let table):
					TableGrid(
						table: table,
						font: AppTheme.transcriptTableBodyFont,
						foregroundStyle: foregroundStyle,
						strongForegroundStyle: strongForegroundStyle
					)
					.padding(.vertical, usesProseTypography ? 8 : 6)
				case .imageGroup(let images):
					MarkdownImageGroupView(images: images, compact: !usesProseTypography)
						.padding(.vertical, usesProseTypography ? 8 : 4)
				case .fileLink(let file):
					MarkdownFileLinkView(link: file, compact: !usesProseTypography)
						.padding(.vertical, usesProseTypography ? 4 : 2)
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		// When the hosting dashboard card is collapsed, ignore hits so individual
		// markdown sub-blocks cannot expand text inside the fixed-height clip.
		.allowsHitTesting(bodyInteractive)
		.onAppear { refreshBlocksCacheIfNeeded() }
		.onChange(of: text) { _, _ in
			refreshBlocksCacheIfNeeded()
		}
	}

	private var blocks: [MarkdownBlock] {
		if cachedText == text {
			return cachedBlocks
		}
		// Cold / ViewInspector: parse once without waiting for onAppear.
		return Self.parseBlocks(text)
	}

	private func refreshBlocksCacheIfNeeded() {
		guard cachedText != text else { return }
		cachedBlocks = Self.parseBlocks(text)
		cachedText = text
	}

	private func headingFont(for level: Int) -> Font {
		if uppercaseHeadings {
			// Compact 10pt section labels (all-caps) for dashboard cards.
			return .system(size: 10, weight: .semibold)
		}
		if usesProseTypography {
			switch level {
			case 1: return .system(size: 21, weight: .bold, design: .rounded)
			case 2: return .system(size: 16, weight: .semibold, design: .rounded)
			default: return .system(size: 11, weight: .semibold, design: .rounded)
			}
		}
		return level == 2 ? .title3 : .headline
	}

	private func headingTracking(for level: Int) -> CGFloat {
		if uppercaseHeadings {
			// +0.09em at 10pt.
			return 0.9
		}
		guard usesProseTypography, level >= 3 else { return 0 }
		return 11 * 0.085
	}

	private func headingTopSpacing(for level: Int) -> CGFloat {
		if uppercaseHeadings {
			return 16
		}
		if usesProseTypography {
			return level >= 3 ? 14 : 10
		}
		return level >= 3 ? 10 : 6
	}

	@ViewBuilder
	private func styledInline(_ content: String, baseOpacity: Double = 1) -> some View {
		if let strong = strongForegroundStyle {
			let base = foregroundStyle.opacity(baseOpacity)
			inlineText(content, base: base, strong: strong.opacity(baseOpacity))
		} else {
			InlineMarkdownText(text: content)
				.foregroundStyle(foregroundStyle.opacity(baseOpacity))
		}
	}

	private func inlineText(_ content: String, base: Color, strong: Color) -> InlineMarkdownText {
		InlineMarkdownText(text: content, baseForeground: base, strongForeground: strong)
	}

	static func parseBlocks(_ text: String) -> [MarkdownBlock] {
		MarkdownParser.parseBlocks(text)
	}
}
