import SwiftUI

/// Wrapping columns with a minimum item width — non-lazy so edit-mode
/// slot frames stay reported even when cards would otherwise virtualize.
struct AdaptiveColumnLayout: Layout {
	var minItemWidth: CGFloat
	var spacing: CGFloat

	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		let width = proposal.width ?? minItemWidth
		guard !subviews.isEmpty else { return CGSize(width: width, height: 0) }
		let columns = columnCount(for: width)
		let itemWidth = self.itemWidth(containerWidth: width, columns: columns)
		var y: CGFloat = 0
		var column = 0
		var rowHeight: CGFloat = 0
		for subview in subviews {
			let size = subview.sizeThatFits(.init(width: itemWidth, height: nil))
			rowHeight = max(rowHeight, size.height)
			column += 1
			if column == columns {
				y += rowHeight + spacing
				column = 0
				rowHeight = 0
			}
		}
		if column > 0 {
			y += rowHeight
		} else if !subviews.isEmpty {
			y -= spacing
		}
		return CGSize(width: width, height: max(0, y))
	}

	func placeSubviews(
		in bounds: CGRect,
		proposal: ProposedViewSize,
		subviews: Subviews,
		cache: inout ()
	) {
		let columns = columnCount(for: bounds.width)
		let itemWidth = self.itemWidth(containerWidth: bounds.width, columns: columns)
		var x = bounds.minX
		var y = bounds.minY
		var column = 0
		var rowHeight: CGFloat = 0
		for subview in subviews {
			let size = subview.sizeThatFits(.init(width: itemWidth, height: nil))
			subview.place(
				at: CGPoint(x: x, y: y),
				anchor: .topLeading,
				proposal: .init(width: itemWidth, height: size.height)
			)
			rowHeight = max(rowHeight, size.height)
			column += 1
			if column == columns {
				x = bounds.minX
				y += rowHeight + spacing
				column = 0
				rowHeight = 0
			} else {
				x += itemWidth + spacing
			}
		}
	}

	private func columnCount(for width: CGFloat) -> Int {
		max(1, Int((width + spacing) / (minItemWidth + spacing)))
	}

	private func itemWidth(containerWidth: CGFloat, columns: Int) -> CGFloat {
		let totalSpacing = spacing * CGFloat(max(0, columns - 1))
		return max(minItemWidth, (containerWidth - totalSpacing) / CGFloat(columns))
	}
}
