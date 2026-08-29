import AppKit
import SwiftUI

struct MarkdownImageMetrics {
	let cardWidth: CGFloat
	let imageHeight: CGFloat

	static let prose = MarkdownImageMetrics(cardWidth: 220, imageHeight: 180)
	static let compact = MarkdownImageMetrics(cardWidth: 132, imageHeight: 100)
}

struct MarkdownImageGroupView: View {
	let images: [MarkdownImage]
	var compact: Bool = false

	private var metrics: MarkdownImageMetrics {
		compact ? .compact : .prose
	}

	var body: some View {
		WrappingHStack(spacing: 12, itemMaxWidth: metrics.cardWidth) {
			ForEach(Array(images.enumerated()), id: \.offset) { _, image in
				MarkdownRemoteImageCard(image: image, metrics: metrics, compact: compact)
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.accessibilityIdentifier("markdown-image-group")
	}
}

struct MarkdownRemoteImageCard: View {
	let image: MarkdownImage
	var metrics: MarkdownImageMetrics = .prose
	var compact: Bool = false

	@Environment(\.openURL) private var openURL

	var body: some View {
		Button {
			openURL(image.openURL)
		} label: {
			VStack(alignment: .leading, spacing: compact ? 6 : 8) {
				MarkdownRemoteImageWell(url: image.source, metrics: metrics)
				if !image.caption.isEmpty {
					Text(image.caption)
						.font(compact ? AppTheme.transcriptCaptionFont : AppTheme.transcriptCalloutFont)
						.foregroundStyle(AppTheme.primaryText)
						.multilineTextAlignment(.leading)
						.lineLimit(compact ? 2 : 3)
						.fixedSize(horizontal: false, vertical: true)
				}
			}
			.frame(width: metrics.cardWidth, alignment: .leading)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.accessibilityElement(children: .combine)
		.accessibilityLabel(image.caption.isEmpty ? "Image" : image.caption)
		.accessibilityIdentifier("markdown-remote-image")
		.help(image.openURL.absoluteString)
	}
}

private struct MarkdownRemoteImageWell: View {
	let url: URL
	let metrics: MarkdownImageMetrics

	@State private var image: NSImage?
	@State private var loadFailed = false

	private var maxPixelSize: CGFloat {
		max(metrics.cardWidth, metrics.imageHeight) * (NSScreen.main?.backingScaleFactor ?? 2)
	}

	var body: some View {
		ZStack {
			RoundedRectangle(cornerRadius: 10, style: .continuous)
				.fill(AppTheme.elevatedBackground)
			if let image {
				Image(nsImage: image)
					.resizable()
					.interpolation(.high)
					.scaledToFit()
					.padding(8)
			} else if loadFailed {
				Image(systemName: "photo")
					.font(.system(size: compactGlyphSize, weight: .medium))
					.foregroundStyle(AppTheme.tertiaryText)
			} else {
				ProgressView()
					.controlSize(.small)
			}
		}
		.frame(width: metrics.cardWidth, height: metrics.imageHeight)
		.clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
		.overlay(
			RoundedRectangle(cornerRadius: 10, style: .continuous)
				.stroke(AppTheme.separator)
		)
		.task(id: url) {
			await loadImage()
		}
	}

	private var compactGlyphSize: CGFloat {
		metrics.imageHeight < 120 ? 18 : 28
	}

	private func loadImage() async {
		if let cached = MarkdownRemoteImageCache.image(for: url) {
			image = cached
			loadFailed = false
			return
		}
		image = nil
		loadFailed = false
		do {
			var request = URLRequest(url: url)
			request.setValue("image/avif,image/webp,image/apng,image/*,*/*;q=0.8", forHTTPHeaderField: "Accept")
			request.timeoutInterval = 20
			let (data, response) = try await URLSession.shared.data(for: request)
			if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
				loadFailed = true
				return
			}
			if let contentType = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type"),
				!contentType.isEmpty,
				!Self.isImageContentType(contentType)
			{
				loadFailed = true
				return
			}
			guard data.count <= MarkdownRemoteImageCache.maxBytes else {
				loadFailed = true
				return
			}
			if let downsampled = ImageDownsampling.downsample(data: data, maxPixelSize: maxPixelSize) {
				MarkdownRemoteImageCache.store(downsampled, for: url)
				image = downsampled
			} else {
				loadFailed = true
			}
		} catch {
			loadFailed = true
		}
	}

	private static func isImageContentType(_ value: String) -> Bool {
		let mime = value.split(separator: ";", maxSplits: 1).first
			.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() } ?? ""
		return mime.hasPrefix("image/") || mime == "application/octet-stream"
	}
}

private enum MarkdownRemoteImageCache {
	static let maxBytes = 8 * 1024 * 1024
	/// Process-wide decode cache. NSCache is thread-safe; marked unsafe for Swift 6
	/// static isolation checks only.
	nonisolated(unsafe) static let store: NSCache<NSURL, NSImage> = {
		let cache = NSCache<NSURL, NSImage>()
		cache.countLimit = 64
		cache.totalCostLimit = 32 * 1024 * 1024
		return cache
	}()

	static func image(for url: URL) -> NSImage? {
		store.object(forKey: url as NSURL)
	}

	static func store(_ image: NSImage, for url: URL) {
		let cost = Int(image.size.width * image.size.height)
		store.setObject(image, forKey: url as NSURL, cost: cost)
	}
}

/// Wraps cards onto the next line when the transcript column is narrower than the row.
private struct WrappingHStack: Layout {
	var spacing: CGFloat = 12
	var itemMaxWidth: CGFloat = 220

	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		arrange(proposal: proposal, subviews: subviews).size
	}

	func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
		let arrangement = arrange(proposal: proposal, subviews: subviews)
		for (subview, frame) in zip(subviews, arrangement.frames) {
			subview.place(
				at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
				proposal: ProposedViewSize(frame.size),
			)
		}
	}

	private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
		let available = proposal.width ?? itemMaxWidth
		let itemWidth = min(itemMaxWidth, available)
		var frames: [CGRect] = []
		var x: CGFloat = 0
		var y: CGFloat = 0
		var rowHeight: CGFloat = 0
		var maxX: CGFloat = 0

		for subview in subviews {
			let size = subview.sizeThatFits(ProposedViewSize(width: itemWidth, height: nil))
			if x > 0, x + size.width > available {
				x = 0
				y += rowHeight + spacing
				rowHeight = 0
			}
			frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
			rowHeight = max(rowHeight, size.height)
			x += size.width + spacing
			maxX = max(maxX, x - spacing)
		}

		return (CGSize(width: max(maxX, 0), height: y + rowHeight), frames)
	}
}
