import SwiftUI

private struct DashboardEditingKey: EnvironmentKey {
	static let defaultValue = false
}

extension EnvironmentValues {
	/// True while Home is in Actions edit mode.
	var dashboardIsEditing: Bool {
		get { self[DashboardEditingKey.self] }
		set { self[DashboardEditingKey.self] = newValue }
	}
}

/// Hide + color controls over an Actions tile in edit mode.
struct DashboardEditOverlay: View {
	let title: String
	let blockID: DashboardBlockID
	var onHide: (() -> Void)? = nil
	var colorSelection: Binding<String>? = nil

	private let cornerRadius = AppTheme.smallCornerRadius
	private let controlSize: CGFloat = 22

	var body: some View {
		RoundedRectangle(cornerRadius: cornerRadius)
			.fill(Color.clear)
			.overlay(alignment: .topTrailing) {
				HStack(spacing: 4) {
					if let colorSelection { colorMenu(selection: colorSelection) }
					if onHide != nil { hideButton }
				}
				.padding(4)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.contentShape(RoundedRectangle(cornerRadius: cornerRadius))
	}

	private func colorMenu(selection: Binding<String>) -> some View {
		Menu {
			colorChoice("Use default", id: "", selection: selection)
			colorChoice("Neutral", id: "neutral", selection: selection)
			ForEach(FlowColorOption.all) { option in
				colorChoice(option.label, id: option.id, selection: selection)
			}
		} label: {
			Image(systemName: "paintpalette")
				.font(.system(size: 11, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
				.frame(width: controlSize, height: controlSize)
				.background(RoundedRectangle(cornerRadius: 8).fill(AppTheme.elevatedBackground))
		}
		.menuStyle(.borderlessButton)
		.menuIndicator(.hidden)
		.fixedSize()
		.help("Choose a color for this action")
		.accessibilityLabel("Color for \(title)")
		.accessibilityValue(selection.wrappedValue.isEmpty ? "Use default" : selection.wrappedValue.capitalized)
		.accessibilityIdentifier("dashboard-color-\(blockID.rawValue)")
	}

	private func colorChoice(_ label: String, id: String, selection: Binding<String>) -> some View {
		Button {
			selection.wrappedValue = id
		} label: {
			if selection.wrappedValue == id {
				Label(label, systemImage: "checkmark")
			} else {
				Text(label)
			}
		}
	}

	private var hideButton: some View {
		Button {
			onHide?()
		} label: {
			Image(systemName: "eye.slash")
				.font(.system(size: 11, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
				.frame(width: controlSize, height: controlSize)
				.background(
					RoundedRectangle(cornerRadius: 8)
						.fill(AppTheme.elevatedBackground)
				)
		}
		.buttonStyle(.plain)
		.help("Hide this action")
		.accessibilityLabel("Hide \(title)")
		.accessibilityIdentifier("dashboard-hide-\(blockID.rawValue)")
	}
}

/// Hidden Actions tiles, shown below The Feed in edit mode.
struct DashboardHiddenActionsTray: View {
	let blocks: [CategoryDashboardBlock]
	let onShow: (DashboardBlockID) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("Hidden actions")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(AppTheme.secondaryText)
			HStack(alignment: .top, spacing: 8) {
				ForEach(blocks, id: \.id) { block in
					chip(for: block)
				}
				Spacer(minLength: 0)
			}
		}
		.padding(14)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(AppTheme.elevatedBackground.opacity(0.6))
		)
		.overlay(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.stroke(AppTheme.separator, lineWidth: 1)
		)
		.accessibilityIdentifier("dashboard-hidden-tray")
	}

	private func chip(for block: CategoryDashboardBlock) -> some View {
		HStack(spacing: 8) {
			Image(systemName: block.systemImage)
				.font(.system(size: 11, weight: .semibold))
				.foregroundStyle(AppTheme.accent)
			Text(block.title)
				.font(.system(size: 12, weight: .medium))
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(1)
			Button("Show") {
				onShow(block.id)
			}
			.buttonStyle(.plain)
			.font(.system(size: 11, weight: .semibold))
			.foregroundStyle(AppTheme.accent)
			.accessibilityLabel("Show \(block.title)")
			.accessibilityIdentifier("dashboard-unhide-\(block.id.rawValue)")
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 8)
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(AppTheme.panelBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: 8)
				.stroke(AppTheme.separator, lineWidth: 1)
		)
		.accessibilityIdentifier("dashboard-hidden-chip-\(block.id.rawValue)")
	}
}
