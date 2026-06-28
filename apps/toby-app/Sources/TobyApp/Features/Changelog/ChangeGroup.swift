import SwiftUI

struct ChangeGroup: View {
	let title: String
	let icon: String
	let color: Color
	let changes: [ChangelogChange]

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(spacing: 6) {
				Image(systemName: icon)
					.foregroundStyle(color)
					.font(.caption2)
				Text(title)
					.font(.caption)
					.fontWeight(.semibold)
					.foregroundStyle(color)
				Spacer()
			}

			ForEach(changes) { change in
				HStack(alignment: .top, spacing: 6) {
					Text("•")
						.foregroundStyle(AppTheme.tertiaryText)
						.font(.callout)
					Text(changeText(change))
						.font(.callout)
						.foregroundStyle(AppTheme.primaryText)
						.fixedSize(horizontal: false, vertical: true)
					Spacer(minLength: 0)
				}
			}
		}
	}

	private func changeText(_ change: ChangelogChange) -> String {
		if let scope = change.scope, !scope.isEmpty {
			return "[\(scope)] \(change.description)"
		}
		return change.description
	}
}
