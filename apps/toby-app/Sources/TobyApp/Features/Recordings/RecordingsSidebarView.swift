import AppKit
import SwiftUI

struct RecordingsSidebarView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil
	var activeRecording: ActiveRecordingInfo? = nil
	let onDeleteRecording: (ListenRecordingSummary) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("Recordings")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 8)
				.padding(.top, 10)
			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if let active = activeRecording {
						ActiveRecordingSidebarRow(
							active: active,
							isSelected: store.selectedActiveRecordingId == active.id
						)
						.onTapGesture {
							store.selectActiveRecording(id: active.id)
						}
						if !store.recordings.isEmpty {
							Divider()
								.overlay(SettingsDesign.cardBorder)
								.padding(.vertical, 4)
						}
					}
					if store.isLoading && store.recordings.isEmpty && activeRecording == nil {
					Text("Loading recordings...")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(10)
				} else if store.recordings.isEmpty && activeRecording == nil {
					Text("No recordings")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(10)
				} else {
					ForEach(store.recordings) { recording in
						Button {
							let holdingCommand = NSApp.currentEvent?.modifierFlags.contains(.command) ?? false
							Task { await store.selectRecording(id: recording.id, holdingCommand: holdingCommand) }
						} label: {
							RecordingSidebarRow(
								recording: recording,
								isSelected: store.selectedRecordingIds.contains(recording.id),
								isProcessing: processingState?.recordingId == recording.id && processingState?.isActive == true,
								processingStage: processingState?.recordingId == recording.id ? processingState?.stage : nil,
							)
						}
						.buttonStyle(.plain)
						.contextMenu {
							Button("Delete Recording", systemImage: "trash", role: .destructive) {
								onDeleteRecording(recording)
							}
						}
					}
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(10)
		}
		.background(AppTheme.sidebarBackground)
	}
}
}

private struct ActiveRecordingSidebarRow: View {
	let active: ActiveRecordingInfo
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 8) {
			Image(systemName: "record.circle")
				.foregroundStyle(.red)
				.symbolEffect(.variableColor.iterative, options: .repeating)
				.frame(width: 18)
			VStack(alignment: .leading, spacing: 3) {
				Text("Recording in progress")
					.font(.callout)
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				Text(sourceText(active.sources))
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 7)
		.padding(.horizontal, 8)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(isSelected ? SettingsDesign.sidebarSelection : Color.clear)
		)
		.accessibilityIdentifier("active-recording-row")
	}
}
