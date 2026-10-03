import AppKit

@MainActor
enum CompanionPortraitArtwork {
	static let url = Bundle.tobyResources.url(forResource: "base-face", withExtension: "png",
		subdirectory: "Resources/Companion")
	static let image = url.flatMap { NSImage(contentsOf: $0) }
	private static let bitmap = url.flatMap { try? Data(contentsOf: $0) }.flatMap { NSBitmapImageRep(data: $0) }

	/// The generated cutout's alpha, rather than a guessed outline, defines the
	/// interactive boundary. Eye layers remain wholly inside the opaque face.
	static func contains(_ point: CGPoint, in bounds: CGRect) -> Bool {
		guard point.x.isFinite, point.y.isFinite, bounds.contains(point),
			bounds.width > 0, bounds.height > 0, let bitmap else { return false }
		let x = min(bitmap.pixelsWide - 1, Int((point.x - bounds.minX) / bounds.width * CGFloat(bitmap.pixelsWide)))
		let y = min(bitmap.pixelsHigh - 1, Int((point.y - bounds.minY) / bounds.height * CGFloat(bitmap.pixelsHigh)))
		return (bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.1
	}
}
