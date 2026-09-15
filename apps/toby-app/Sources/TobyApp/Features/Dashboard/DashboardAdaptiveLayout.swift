import SwiftUI

/// Waterfall columns with bounded widths. Each card is placed in the shortest
/// column, allowing compact cards to stack beside taller briefing cards.
struct AdaptiveColumnLayout: Layout {
	var minItemWidth: CGFloat
	var maxItemWidth: CGFloat = 460
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
		var columnHeights = Array(repeating: CGFloat.zero, count: columns)
		for subview in subviews {
			let size = subview.sizeThatFits(.init(width: itemWidth, height: nil))
			let column = Self.shortestColumn(in: columnHeights)
			columnHeights[column] += size.height + spacing
		}
		let height = max(0, (columnHeights.max() ?? 0) - spacing)
		return CGSize(width: width, height: height)
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
		var columnHeights = Array(repeating: CGFloat.zero, count: columns)
		for subview in subviews {
			let size = subview.sizeThatFits(.init(width: itemWidth, height: nil))
			let column = Self.shortestColumn(in: columnHeights)
			let x = bounds.minX + CGFloat(column) * (itemWidth + spacing)
			let y = bounds.minY + columnHeights[column]
			subview.place(
				at: CGPoint(x: x, y: y),
				anchor: .topLeading,
				proposal: .init(width: itemWidth, height: size.height)
			)
			columnHeights[column] += size.height + spacing
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
		return min(maxItemWidth, max(minItemWidth, raw))
	}

	static func shortestColumn(in heights: [CGFloat]) -> Int {
		if heights.allSatisfy({ $0 == 0 }) {
			return 0
		}
		return heights.indices.min { lhs, rhs in
			// Once layout has started, prefer the trailing column for equal
			// heights so the next compact card visibly stacks with its neighbor
			// instead of recreating a table-like row.
			if heights[lhs] == heights[rhs] { return lhs > rhs }
			return heights[lhs] < heights[rhs]
		} ?? 0
	}
}
