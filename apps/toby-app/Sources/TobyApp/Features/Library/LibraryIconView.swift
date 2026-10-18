import AppKit
import SwiftUI

enum LibraryIconMetrics {
	static let iconSide: CGFloat = 72
	/// Leading artwork in a list row. Larger than a feature-browser glyph so an image still reads.
	static let listThumbnailSide: CGFloat = 32
	static let listThumbnailCornerRadius: CGFloat = 6
	static let columnMin: CGFloat = 112
	static let columnMax: CGFloat = 148
	static let columnSpacing: CGFloat = 16
	static let rowSpacing: CGFloat = 20
	static let labelHeight: CGFloat = 32
	static let cornerRadius: CGFloat = 10
}

/// Finder-style icon grid: file artwork with the name centered underneath.
struct LibraryIconView: View {
	@Bindable var store: LibraryStore
	var onQuickLook: (LibraryAsset) -> Void = { _ in }

	private var columns: [GridItem] {
		[
			GridItem(
				.adaptive(minimum: LibraryIconMetrics.columnMin, maximum: LibraryIconMetrics.columnMax),
				spacing: LibraryIconMetrics.columnSpacing,
				alignment: .top
			)
		]
	}

	var body: some View {
		FeatureBrowserDeselectingScroll(onClearSelection: { store.clearSelection() }) {
			LazyVGrid(columns: columns, alignment: .center, spacing: LibraryIconMetrics.rowSpacing) {
				ForEach(store.items) { item in
					iconCell(item)
				}
			}
			.padding(.horizontal, AppTheme.contentPadding)
			.padding(.vertical, 20)
		}
		.accessibilityIdentifier("library-icon-grid")
	}

	private func iconCell(_ item: LibraryAsset) -> some View {
		let isSelected = store.selectedItemIds.contains(item.id)
		let badge = item.isPending ? "Indexing" : (item.isFailed ? "Failed" : nil)
		return Button {
			activateLibraryItem(item, store: store, onQuickLook: onQuickLook)
		} label: {
			VStack(spacing: 8) {
				LibraryItemArtwork(item: item, side: LibraryIconMetrics.iconSide)
					.intelligenceOutline(
						isActive: item.isPending,
						in: RoundedRectangle(cornerRadius: 8, style: .continuous)
					)
				Text(item.title)
					.font(.system(size: 12))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.multilineTextAlignment(.center)
					.lineLimit(2)
					.truncationMode(.tail)
					.frame(maxWidth: .infinity, minHeight: LibraryIconMetrics.labelHeight, alignment: .top)
				if let badge {
					Text(badge)
						.font(.system(size: 10, weight: .medium))
						.foregroundStyle(item.isFailed ? AppTheme.statusErrorForeground : AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}
			.padding(.horizontal, 6)
			.padding(.vertical, 8)
			.frame(maxWidth: .infinity)
			.contentShape(Rectangle())
			.background {
				RoundedRectangle(cornerRadius: LibraryIconMetrics.cornerRadius, style: .continuous)
					.fill(isSelected ? AppTheme.selection : Color.clear)
			}
		}
		.buttonStyle(.plain)
		.libraryItemDoubleClick {
			previewLibraryItem(item, store: store, onQuickLook: onQuickLook)
		}
		.transaction { $0.disablesAnimations = true }
		.accessibilityElement(children: .combine)
		.accessibilityLabel(iconAccessibilityLabel(title: item.title, badge: badge))
		.accessibilityAddTraits(isSelected ? [.isSelected] : [])
		.accessibilityIdentifier("library-icon-\(item.id)")
		.accessibilityAction(named: "Quick Look") {
			previewLibraryItem(item, store: store, onQuickLook: onQuickLook)
		}
		.libraryItemMenu(item: item, store: store, onQuickLook: onQuickLook)
	}

	private func iconAccessibilityLabel(title: String, badge: String?) -> String {
		if let badge { return "\(title), \(badge)" }
		return title
	}
}

/// File icon, or a downsampled picture when the item is an image on disk.
struct LibraryItemArtwork: View {
	let item: LibraryAsset
	let side: CGFloat
	@State private var image: NSImage?

	var body: some View {
		Group {
			if let image {
				Image(nsImage: image)
					.resizable()
					.scaledToFit()
			} else {
				Image(systemName: item.systemImage)
					.font(.system(size: min(32, max(14, side * 0.44)), weight: .regular))
					.foregroundStyle(AppTheme.secondaryText)
			}
		}
		.frame(width: side, height: side)
		.accessibilityHidden(true)
		.transaction { $0.disablesAnimations = true }
		.task(id: LibraryItemArtworkLoader.cacheKey(item: item, pointSize: side)) {
			image = await LibraryItemArtworkLoader.load(item: item, pointSize: side)
		}
	}
}

@MainActor
enum LibraryItemArtworkLoader {
	private static var cache: [String: NSImage] = [:]
	private static let cacheLimit = 240

	static func cacheKey(item: LibraryAsset, pointSize: CGFloat) -> String {
		"\(item.id)|\(item.contentHash)|\(Int(pointSize.rounded()))"
	}

	static func load(item: LibraryAsset, pointSize: CGFloat) async -> NSImage? {
		let key = cacheKey(item: item, pointSize: pointSize)
		if let cached = cache[key] { return cached }
		let loaded = await load(
			path: item.absolutePath,
			mimeType: item.mimeType,
			pointSize: pointSize
		)
		if let loaded {
			if cache.count >= cacheLimit {
				cache.removeAll(keepingCapacity: true)
			}
			cache[key] = loaded
		}
		return loaded
	}

	/// Loads artwork for an arbitrary file. Used by tests so they do not write
	/// into the real library directory.
	static func load(path: String, mimeType: String, pointSize: CGFloat) async -> NSImage? {
		let scale = NSScreen.main?.backingScaleFactor ?? 2
		return await fetch(
			path: path,
			mimeType: mimeType,
			pointSize: pointSize,
			pixelSize: pointSize * scale
		)
	}

	/// Test hook. Production views rely on the cache only within a session.
	static func resetCacheForTesting() {
		cache.removeAll()
	}

	private static func fetch(
		path: String,
		mimeType: String,
		pointSize: CGFloat,
		pixelSize: CGFloat
	) async -> NSImage? {
		if mimeType.hasPrefix("image/") {
			let thumbnail = await Task.detached(priority: .utility) { () -> CGImage? in
				ImageDownsampling.thumbnail(
					url: URL(fileURLWithPath: path),
					maxPixelSize: pixelSize
				)
			}.value
			if let thumbnail {
				return NSImage(
					cgImage: thumbnail,
					size: NSSize(width: thumbnail.width, height: thumbnail.height)
				)
			}
		}
		guard FileManager.default.fileExists(atPath: path) else { return nil }
		let icon = NSWorkspace.shared.icon(forFile: path)
		icon.size = NSSize(width: pointSize, height: pointSize)
		return icon
	}
}

/// Segmented list / icon switch for the Library contextual toolbar.
struct LibraryLayoutPicker: View {
	@Binding var selection: LibraryLayout

	var body: some View {
		Picker("Library view", selection: $selection) {
			ForEach(LibraryLayout.allCases) { mode in
				Label(mode.help, systemImage: mode.systemImage)
					.tag(mode)
					.accessibilityIdentifier("library-layout-\(mode.rawValue)")
			}
		}
		.pickerStyle(.segmented)
		.labelStyle(.iconOnly)
		.labelsHidden()
		.fixedSize()
		.accessibilityLabel("Library view")
		.accessibilityIdentifier("library-layout-picker")
		.help("Switch between list and icons")
	}
}
