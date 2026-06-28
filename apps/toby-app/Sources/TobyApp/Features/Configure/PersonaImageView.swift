import AppKit
import SwiftUI

// MARK: - Persona Image View

struct PersonaImageView: View {
	let url: URL
	var size: CGFloat = 28

	@State private var image: NSImage?
	@State private var loadFailed = false

	private var maxPixelSize: CGFloat {
		size * (NSScreen.main?.backingScaleFactor ?? 2)
	}

	var body: some View {
		Group {
			if let image {
				Image(nsImage: image)
					.resizable()
					.interpolation(.high)
					.scaledToFill()
					.frame(width: size, height: size)
					.clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
			} else if loadFailed {
				defaultPersonaImage
			} else {
				RoundedRectangle(cornerRadius: 4, style: .continuous)
					.fill(AppTheme.panelBackground)
					.frame(width: size, height: size)
					.overlay {
						ProgressView()
							.controlSize(.small)
					}
			}
		}
		.frame(width: size, height: size)
		.task(id: url) {
			await loadImage()
		}
	}

	private var defaultPersonaImage: some View {
		if let bundled = Bundle.tobyResources.url(forResource: "default-persona", withExtension: "png"),
			let data = try? Data(contentsOf: bundled),
			let downsampled = PersonaImageView.downsample(data: data, maxPixelSize: maxPixelSize)
		{
			return AnyView(
				Image(nsImage: downsampled)
					.resizable()
					.interpolation(.high)
					.scaledToFill()
					.frame(width: size, height: size)
					.clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
			)
		}
		return AnyView(
			RoundedRectangle(cornerRadius: 4, style: .continuous)
				.fill(AppTheme.panelBackground)
				.frame(width: size, height: size)
				.overlay {
					Image(systemName: "person.crop.circle")
						.font(.system(size: size * 0.6))
						.foregroundStyle(AppTheme.tertiaryText)
				}
		)
	}

	private func loadImage() async {
		image = nil
		loadFailed = false
		do {
			let (data, response) = try await URLSession.shared.data(from: url)
			if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
				loadFailed = true
				return
			}
			if let downsampled = PersonaImageView.downsample(data: data, maxPixelSize: maxPixelSize) {
				image = downsampled
			} else {
				loadFailed = true
			}
		} catch {
			loadFailed = true
		}
	}

	/// Downsample image data to a target max pixel dimension using CGImageSource thumbnails.
	/// Produces sharper results than `.resizable()` scaling alone and avoids loading full-res bitmaps.
	static func downsample(data: Data, maxPixelSize: CGFloat) -> NSImage? {
		guard let source = CGImageSourceCreateWithData(data as CFData, [
			kCGImageSourceShouldCache: false,
		] as CFDictionary) else {
			return nil
		}
		let options: [CFString: Any] = [
			kCGImageSourceCreateThumbnailFromImageAlways: true,
			kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
			kCGImageSourceCreateThumbnailWithTransform: true,
			kCGImageSourceShouldCacheImmediately: true,
		]
		guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
			return nil
		}
		return NSImage(cgImage: cgImage, size: NSSize(width: cgImage.width, height: cgImage.height))
	}
}
