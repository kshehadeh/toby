import AppKit
import ImageIO

enum ImageDownsampling {
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
