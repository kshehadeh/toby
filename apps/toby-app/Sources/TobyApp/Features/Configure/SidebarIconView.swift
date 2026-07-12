import AppKit
import SwiftUI

/// How a remote PNG icon should be rendered.
enum IconRendering: Sendable {
	/// Multicolor brand art — display as-is.
	case original
	/// Monochrome glyph (typically white-on-transparent) — template-tint with text color.
	case template
}

struct SidebarIconView: View {
	let url: URL
	let fallbackSystemName: String
	let isSelected: Bool
	var rendering: IconRendering = .original
	@State private var image: NSImage?

	/// Infer monochrome template icons from known daemon URL paths.
	/// Only true alpha-glyphs (white ink on transparent) should be templates.
	/// Filled art (Toby logo, Apple Reminders card, brand logos) must stay original —
	/// template rendering turns their opaque regions into solid color boxes.
	static func rendering(for url: URL) -> IconRendering {
		let path = url.path.lowercased()
		// AI provider marks are pure white glyphs with transparent backgrounds.
		if path.contains("/icons/ai/") {
			return .template
		}
		// macOS plugin mark is a white glyph on transparent.
		if path.contains("/api/plugins/macos/icon") {
			return .template
		}
		return .original
	}

	init(
		url: URL,
		fallbackSystemName: String,
		isSelected: Bool,
		rendering: IconRendering? = nil
	) {
		self.url = url
		self.fallbackSystemName = fallbackSystemName
		self.isSelected = isSelected
		self.rendering = rendering ?? Self.rendering(for: url)
	}

	var body: some View {
		Group {
			if let image {
				let base = Image(nsImage: image)
					.resizable()
					.interpolation(.high)
					.scaledToFit()
					.opacity(isSelected ? 1.0 : 0.6)
				if rendering == .template {
					base.foregroundStyle(AppTheme.primaryText)
				} else {
					base
				}
			} else {
				Image(systemName: fallbackSystemName)
					.font(.system(size: 14, weight: .semibold))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
			}
		}
		.task(id: "\(url.absoluteString)|\(rendering == .template)") {
			await loadImage()
		}
	}

	private func loadImage() async {
		do {
			let (data, response) = try await URLSession.shared.data(from: url)
			if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
				return
			}
			if let nsImage = NSImage(data: data) {
				// Only set isTemplate for true monochrome glyphs. Filled PNGs
				// become solid boxes when treated as templates.
				nsImage.isTemplate = (rendering == .template)
				await MainActor.run { image = nsImage }
			}
		} catch {
			// Keep showing fallback SF Symbol
		}
	}
}
