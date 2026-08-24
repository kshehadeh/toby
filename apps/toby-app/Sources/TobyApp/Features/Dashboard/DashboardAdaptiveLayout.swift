import SwiftUI

/// Wrapping columns with a minimum item width — non-lazy so edit-mode
/// slot frames stay reported even when cards would otherwise virtualize.
struct AdaptiveColumnLayout: Layout {
	var minItemWidth: CGFloat
	var spacing: CGFloat

	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		// ViewThatFits / unconstrained stacks propose infinite width. Never
		// convert that to Int — report a one-column ideal instead.
		let width = Self.resolvedWidth(proposal.width, minItemWidth: minItemWidth)
		guard !subviews.isEmpty else { return CGSize(width: width, height: 0) }
		let columns = Self.columnCount(
			containerWidth: width,
			minItemWidth: minItemWidth,
			spacing: spacing,
			itemCount: subviews.count
		)
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
		let width = Self.resolvedWidth(bounds.width, minItemWidth: minItemWidth)
		let columns = Self.columnCount(
			containerWidth: width,
			minItemWidth: minItemWidth,
			spacing: spacing,
			itemCount: subviews.count
		)
		let itemWidth = self.itemWidth(containerWidth: width, columns: columns)
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

	/// Finite positive width for column math. Nil / infinite / NaN → one column.
	static func resolvedWidth(_ width: CGFloat?, minItemWidth: CGFloat) -> CGFloat {
		guard let width, width.isFinite, width > 0 else { return minItemWidth }
		return width
	}

	static func columnCount(
		containerWidth: CGFloat,
		minItemWidth: CGFloat,
		spacing: CGFloat,
		itemCount: Int = Int.max
	) -> Int {
		let width = resolvedWidth(containerWidth, minItemWidth: minItemWidth)
		let denominator = minItemWidth + spacing
		guard denominator > 0 else { return 1 }
		let raw = (width + spacing) / denominator
		guard raw.isFinite else { return 1 }
		// Cap before Int() — a huge finite width would still trap on conversion.
		let count = max(1, Int(min(raw, 32).rounded(.down)))
		guard itemCount > 0, itemCount != Int.max else { return count }
		return min(count, itemCount)
	}

	private func itemWidth(containerWidth: CGFloat, columns: Int) -> CGFloat {
		let safeColumns = max(1, columns)
		let totalSpacing = spacing * CGFloat(max(0, safeColumns - 1))
		let raw = (containerWidth - totalSpacing) / CGFloat(safeColumns)
		guard raw.isFinite else { return minItemWidth }
		return max(minItemWidth, raw)
	}
}
