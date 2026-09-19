import SwiftUI

struct MemoriesInspectorBar: View {
	@Bindable var store: MemoriesStore
	@State private var isExpanded = true

	var body: some View {
		VStack(spacing: 0) {
			Rectangle()
				.fill(SettingsDesign.cardBorder)
				.frame(height: 1)
			if store.selectedMemoryIds.count > 1 {
				multiSelectionContent
			} else if let memory = store.inspectedMemory {
				singleSelectionContent(memory)
			} else {
				emptySelectionContent
			}
		}
		.frame(maxWidth: .infinity)
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("memories-inspector-bar")
	}

	private func singleSelectionContent(_ memory: MemoryItem) -> some View {
		VStack(alignment: .leading, spacing: 0) {
			inspectorHeader {
				Button {
					withAnimation(nil) {
						isExpanded.toggle()
					}
				} label: {
					HStack(spacing: 6) {
						Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
							.font(.system(size: 10, weight: .semibold))
							.foregroundStyle(AppTheme.tertiaryText)
							.frame(width: 12)
						Text("Details")
							.font(.system(size: 12, weight: .semibold))
							.foregroundStyle(SettingsDesign.rowTitle)
					}
					.contentShape(Rectangle())
				}
				.buttonStyle(.plain)
				.accessibilityIdentifier("memories-inspector-toggle")
				.accessibilityLabel(isExpanded ? "Hide details" : "Show details")
			} trailing: {
				Button {
					store.startEdit(memory)
				} label: {
					Label("Edit", systemImage: "square.and.pencil")
				}
				.controlSize(.small)
				.disabled(store.isSaving)
				.accessibilityIdentifier("edit-memory-button")
				Button(role: .destructive) {
					store.requestDelete(memory)
				} label: {
					Label("Delete", systemImage: "trash")
				}
				.controlSize(.small)
				.disabled(store.isSaving)
				.accessibilityIdentifier("delete-memory-button")
			}

			if isExpanded {
				ScrollView {
					VStack(alignment: .leading, spacing: 12) {
						Text(memory.value)
							.font(.body)
							.foregroundStyle(SettingsDesign.rowTitle)
							.frame(maxWidth: .infinity, alignment: .leading)
							.fixedSize(horizontal: false, vertical: true)
							.textSelection(.enabled)
							.accessibilityIdentifier("memories-inspector-value")

						Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 16, verticalSpacing: 6) {
							inspectorFact("Type", memory.type)
							if let subject = memory.subject, !subject.isEmpty {
								inspectorFact("Subject", subject)
							}
							inspectorFact("Sensitivity", memory.sensitivity)
							inspectorFact("Visibility", memory.visibility)
							inspectorFact(
								"Confidence",
								String(format: "%.0f%%", memory.confidence * 100)
							)
							if let sources = memory.sourceIds, !sources.isEmpty {
								inspectorFact("Sources", "\(sources.count)")
							}
							inspectorFact(
								"Embedding",
								memory.embeddingModel ?? "None"
							)
							inspectorFact("Created", MemoryDateFormat.display(memory.createdAt))
							inspectorFact("Updated", MemoryDateFormat.display(memory.updatedAt))
						}
					}
					.padding(.horizontal, 16)
					.padding(.bottom, 14)
				}
				.frame(maxHeight: 220)
			}
		}
	}

	@ViewBuilder
	private func inspectorFact(_ label: String, _ value: String) -> some View {
		GridRow {
			Text(label)
				.font(.system(size: 12))
				.foregroundStyle(SettingsDesign.rowDescription)
			Text(value)
				.font(.system(size: 12))
				.foregroundStyle(SettingsDesign.rowTitle)
				.textSelection(.enabled)
		}
	}

	private var emptySelectionContent: some View {
		VStack(spacing: 8) {
			Image(systemName: "brain.head.profile")
				.font(.system(size: 28, weight: .regular))
				.foregroundStyle(AppTheme.tertiaryText)
				.accessibilityHidden(true)
			Text("No memory selected")
				.font(.headline)
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("Select a memory to view its details")
				.font(.subheadline)
				.foregroundStyle(SettingsDesign.rowDescription)
		}
		.frame(maxWidth: .infinity)
		.padding(.horizontal, 16)
		.padding(.vertical, 28)
		.accessibilityElement(children: .combine)
		.accessibilityIdentifier("memories-inspector-empty")
	}

	private var multiSelectionContent: some View {
		inspectorHeader {
			Text("\(store.selectedMemoryIds.count) memories selected")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
				.accessibilityIdentifier("memories-multi-selection-label")
		} trailing: {
			Button(role: .destructive) {
				store.requestDeleteSelected()
			} label: {
				Label("Delete", systemImage: "trash")
			}
			.controlSize(.small)
			.disabled(store.isSaving)
			.accessibilityIdentifier("delete-memories-button")
		}
		.padding(.bottom, 10)
	}

	private func inspectorHeader<Leading: View, Trailing: View>(
		@ViewBuilder leading: () -> Leading,
		@ViewBuilder trailing: () -> Trailing
	) -> some View {
		HStack(spacing: 10) {
			leading()
			Spacer(minLength: 8)
			trailing()
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 10)
	}
}

enum MemoryDateFormat {
	static func display(_ iso: String) -> String {
		let fractional = ISO8601DateFormatter()
		fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		if let date = fractional.date(from: iso) {
			return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
		}
		let plain = ISO8601DateFormatter()
		plain.formatOptions = [.withInternetDateTime]
		guard let date = plain.date(from: iso) else { return iso }
		return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
	}
}
