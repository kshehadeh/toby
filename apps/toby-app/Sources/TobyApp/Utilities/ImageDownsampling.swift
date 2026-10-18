import AppKit
import ImageIO

enum ImageDownsampling {
	/// Downsample image data to a target max pixel dimension using CGImageSource thumbnails.
	/// Produces sharper results than `.resizable()` scaling alone and avoids loading full-res bitmaps.
	static func downsample(data: Data, maxPixelSize: CGFloat) -> NSImage? {
		guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions),
			let cgImage = thumbnail(from: source, maxPixelSize: maxPixelSize) else {
			return nil
		}
		return NSImage(cgImage: cgImage, size: NSSize(width: cgImage.width, height: cgImage.height))
	}

	/// Downsample a file without decoding the full bitmap into memory first.
	static func downsample(url: URL, maxPixelSize: CGFloat) -> NSImage? {
		guard let cgImage = thumbnail(url: url, maxPixelSize: maxPixelSize) else { return nil }
		return NSImage(cgImage: cgImage, size: NSSize(width: cgImage.width, height: cgImage.height))
	}

	/// Sendable thumbnail for work started off the main actor.
	static func thumbnail(url: URL, maxPixelSize: CGFloat) -> CGImage? {
		guard let source = CGImageSourceCreateWithURL(url as CFURL, sourceOptions) else {
			return nil
		}
		return thumbnail(from: source, maxPixelSize: maxPixelSize)
	}

	private static var sourceOptions: CFDictionary {
		[kCGImageSourceShouldCache: false] as CFDictionary
	}

	private static func thumbnail(from source: CGImageSource, maxPixelSize: CGFloat) -> CGImage? {
		let options: [CFString: Any] = [
			kCGImageSourceCreateThumbnailFromImageAlways: true,
			kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
			kCGImageSourceCreateThumbnailWithTransform: true,
			kCGImageSourceShouldCacheImmediately: true,
		]
		return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
	}
}
