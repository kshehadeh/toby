import SwiftUI

struct CollapsiblePluginsList: View {
	let plugins: [String]
	@State private var isExpanded = false

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Button {
				withAnimation(.easeInOut(duration: 0.2)) {
					isExpanded.toggle()
				}
			} label: {
				HStack(spacing: 8) {
					Text("Plugins")
						.font(.caption)
						.foregroundStyle(AppTheme.secondaryText)
					Spacer()
					Text("\(plugins.count)")
						.font(.caption)
						.foregroundStyle(AppTheme.primaryText)
					Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
						.accessibilityLabel(isExpanded ? "Collapse" : "Expand")
						.font(.caption2)
						.foregroundStyle(AppTheme.tertiaryText)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityLabel("Plugins, \(plugins.count) available")
			if isExpanded {
				VStack(alignment: .leading, spacing: 4) {
					ForEach(plugins, id: \.self) { plugin in
						Text(plugin)
							.font(.caption)
							.foregroundStyle(AppTheme.primaryText)
							.lineLimit(1)
					}
				}
				.padding(.leading, 8)
				.padding(.top, 2)
			}
		}
	}
}
