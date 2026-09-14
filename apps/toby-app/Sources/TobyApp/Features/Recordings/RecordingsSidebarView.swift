import AppKit
import SwiftUI

struct RecordingsSidebarView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil
	var activeRecording: ActiveRecordingInfo? = nil
	let onDeleteRecording: (ListenRecordingSummary) -> Void

	private var isListEmpty: Bool {
		store.recordings.isEmpty && activeRecording == nil
	}

	var body: some View {
		FeatureBrowserList(
			isLoading: store.isLoading,
			isEmpty: isListEmpty,
			loadingText: "Loading recordings...",
			emptyText: "No recordings",
			onClearSelection: { store.showRecordingsOverview() }
		) {
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
