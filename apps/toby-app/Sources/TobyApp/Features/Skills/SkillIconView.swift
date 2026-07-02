import SwiftUI

/// Displays a skill's custom icon when available, otherwise the default wand glyph.
struct SkillIconView: View {
	let iconURL: URL?
	var size: CGFloat = 56
	var cornerRadius: CGFloat = 13

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
					.clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
			} else {
				placeholder
			}
		}
		.frame(width: size, height: size)
		.task(id: iconURL) {
			await loadImage()
		}
	}

	private var placeholder: some View {
		RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
			.fill(AppTheme.accent.opacity(0.18))
			.frame(width: size, height: size)
			.overlay {
				Image(systemName: "wand.and.stars")
					.font(.system(size: size * 0.4, weight: .medium))
					.foregroundStyle(AppTheme.accent)
			}
	}

	private func loadImage() async {
		image = nil
		loadFailed = false
		guard let iconURL else {
			loadFailed = true
			return
		}
		do {
			let (data, response) = try await URLSession.shared.data(from: iconURL)
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
}
