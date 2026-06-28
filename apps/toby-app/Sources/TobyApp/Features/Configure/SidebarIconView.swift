import AppKit
import SwiftUI

struct SidebarIconView: View {
	let url: URL
	let fallbackSystemName: String
	let isSelected: Bool
	@State private var image: NSImage?

	var body: some View {
		Group {
			if let image {
				Image(nsImage: image)
					.resizable()
					.interpolation(.high)
					.scaledToFit()
					.opacity(isSelected ? 1.0 : 0.6)
			} else {
				Image(systemName: fallbackSystemName)
					.font(.system(size: 14, weight: .semibold))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
			}
		}
		.task(id: url) {
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
				await MainActor.run { image = nsImage }
			}
		} catch {
			// Keep showing fallback SF Symbol
		}
	}
}
