import SwiftUI

struct FollowupsSettingsView: View {
	@Bindable var store: FollowupsSettingsStore
	@State private var pendingInstructionDeletion: FollowupInstruction?

	var body: some View {
		Group {
			if store.isLoading && !store.hasLoaded {
				ProgressView("Loading follow-ups…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if !store.hasLoaded, let errorMessage = store.errorMessage {
				ContentUnavailableView {
					Label("Follow-ups unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				} actions: {
					Button("Try again") { Task { await store.refresh() } }
				}
			} else {
				settingsForm
			}
		}
		.toolbar {
			ToolbarItem(placement: .primaryAction) {
				Button("Check now", systemImage: "arrow.clockwise") {
					Task { await store.runNow() }
				}
				.disabled(store.isRunning || store.isSaving || store.hasUnsavedChanges || !store.hasLoaded || !store.configuration.enabled)
				.help(store.hasUnsavedChanges ? "Save Changes before checking activity." : store.configuration.enabled ? "Check connected activity now." : "Enable automatic follow-ups before checking activity.")
				.accessibilityIdentifier("followups-run-now")
			}
		}
		.task {
			if !store.hasLoaded { await store.refresh() }
		}
		.alert(
			"Delete follow-up instruction?",
			isPresented: Binding(
				get: { pendingInstructionDeletion != nil },
				set: { if !$0 { pendingInstructionDeletion = nil } }
			),
			presenting: pendingInstructionDeletion
		) { instruction in
			Button("Cancel", role: .cancel) { pendingInstructionDeletion = nil }
			Button("Delete", role: .destructive) {
				pendingInstructionDeletion = nil
				Task { await store.deleteInstruction(instruction) }
			}
		} message: { _ in
			Text("Toby will no longer use this instruction when evaluating follow-ups.")
		}
		.accessibilityIdentifier("followups-settings")
	}

	private var settingsForm: some View {
		Form {
			if let error = store.errorMessage {
				Section {
					InlineStatusMessage(message: error, tone: .error)
				}
			}
			if let status = store.statusMessage {
				Section {
					InlineStatusMessage(message: status, tone: .success)
				}
			}

			Section {
				Toggle(isOn: $store.configuration.enabled) {
					VStack(alignment: .leading, spacing: 2) {
						Text("Create follow-up todos")
						Text("Toby checks connected activity for replies you owe, replies you’re waiting for, and commitments.")
							.font(.caption)
							.foregroundStyle(.secondary)
					}
				}
				.toggleStyle(.switch)
				.accessibilityIdentifier("followups-enabled")
			} header: {
				Text("Automatic follow-ups")
			} footer: {
				Text("Toby creates todos in the From Toby list. You can reopen an automatically completed todo from its explanation.")
			}

			Section {
				if store.sources.isEmpty {
					Text("No activity sources are available. Connect Mail or Slack in Settings → Sources, or allow Calendar access, to enable follow-up detection.")
						.font(.callout)
						.foregroundStyle(.secondary)
				} else {
					ForEach(store.sources) { source in
						Toggle(isOn: sourceBinding(source)) {
							VStack(alignment: .leading, spacing: 3) {
								Text(source.displayName)
								Text(source.evidenceOnly ? "Evidence for updating open follow-ups" : "Can create and update follow-ups")
									.font(.caption)
									.foregroundStyle(.secondary)
							}
						}
						.toggleStyle(.switch)
						.accessibilityIdentifier("followups-source-\(source.id)")

						if let error = source.cursor?.lastError {
							Label(error, systemImage: "exclamationmark.triangle")
								.font(.caption)
								.foregroundStyle(AppTheme.statusErrorForeground)
						} else if let lastSuccessAt = source.cursor?.lastSuccessAt {
							Text("Last checked \(Self.readableDate(lastSuccessAt)) · \(source.cursor?.ingestedCount ?? 0) total items ingested")
								.font(.caption)
								.foregroundStyle(.secondary)
						} else {
							Text("Waiting for the first check")
								.font(.caption)
								.foregroundStyle(.secondary)
						}
					}
				}
			} header: {
				Text("Activity sources")
			} footer: {
				Text("Email, calendar, and memories are on by default. Toby chats and todos provide evidence for updating open follow-ups.")
			}

			Section {
				Toggle("You owe someone a reply", isOn: $store.configuration.kinds.oweReply)
				Toggle("You’re waiting for a reply", isOn: $store.configuration.kinds.awaitingReply)
				Toggle("You made a commitment", isOn: $store.configuration.kinds.commitment)

				LabeledContent("Wait before opening a waiting item") {
					Stepper(value: $store.configuration.awaitingReplyDays, in: 0...30) {
						Text("\(store.configuration.awaitingReplyDays) days")
							.monospacedDigit()
					}
					.controlSize(.small)
				}
			} header: {
				Text("What Toby tracks")
			}

			Section {
				thresholdRow(
					title: "Open confidence",
					value: $store.configuration.thresholds.open
				)
				thresholdRow(
					title: "Close confidence",
					value: $store.configuration.thresholds.close
				)
			} header: {
				Text("Decision thresholds")
			} footer: {
				Text("Higher values require stronger evidence before Toby opens or completes a follow-up.")
			}

			Section {
				Toggle("Complete todos when evidence shows the work is done", isOn: $store.configuration.autoComplete)
				Toggle("Show a notification after automatic completion", isOn: $store.configuration.notifications)
				LabeledContent("Check every") {
					Stepper(value: $store.configuration.intervalMinutes, in: 5...1440, step: 5) {
						Text(Self.intervalLabel(store.configuration.intervalMinutes))
							.monospacedDigit()
					}
					.controlSize(.small)
				}
				LabeledContent("Daily evaluation limit") {
					Stepper(value: $store.configuration.maxEvaluationsPerDay, in: 1...5000, step: 25) {
						Text("\(store.configuration.maxEvaluationsPerDay)")
							.monospacedDigit()
					}
					.controlSize(.small)
				}
			} header: {
				Text("Completion and schedule")
			}

			instructionsSection

			Section {
				HStack {
					Spacer()
					Button("Save Changes") { Task { await store.save() } }
						.buttonStyle(.borderedProminent)
						.disabled(!store.hasUnsavedChanges || store.isSaving)
						.accessibilityIdentifier("followups-save")
				}
			} footer: {
				Text("Settings are saved on this Mac.")
			}
		}
		.tobySettingsFormStyle()
		.disabled(store.isLoading || store.isSaving || !store.hasLoaded)
		.accessibilityIdentifier("followups-settings-form")
	}

	private var instructionsSection: some View {
		Section {
			if store.instructions.isEmpty {
				Text("No instructions yet. Add guidance about what Toby should prioritize or ignore.")
					.font(.callout)
					.foregroundStyle(.secondary)
			}
			ForEach(store.instructions) { instruction in
				VStack(alignment: .leading, spacing: 8) {
					TextField(
						"Follow-up instruction",
						text: instructionBinding(instruction),
						axis: .vertical
					)
					.lineLimit(2...5)
					.accessibilityIdentifier("followups-instruction-\(instruction.id)")
					HStack {
						Button("Save") { Task { await store.saveInstruction(instruction.id) } }
							.disabled(
								store.isSaving
									|| store.instructionDrafts[instruction.id] == instruction.text
									|| store.instructionDrafts[instruction.id]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
							)
						Button("Delete", systemImage: "trash", role: .destructive) {
							pendingInstructionDeletion = instruction
						}
						.labelStyle(.iconOnly)
						.help("Delete instruction")
						.accessibilityLabel("Delete instruction")
						.accessibilityIdentifier("followups-delete-instruction-\(instruction.id)")
					}
				}
			}
			HStack {
				TextField("Add an instruction", text: newInstructionBinding)
					.accessibilityIdentifier("followups-new-instruction")
				Button("Add") { Task { await store.addInstruction() } }
					.disabled(
						store.isSaving
							|| store.instructions.count >= 20
							|| store.newInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
					)
					.accessibilityIdentifier("followups-add-instruction")
			}
			Text("\(store.instructions.count) of 20 instructions")
				.font(.caption)
				.foregroundStyle(.secondary)
		} header: {
			Text("Instructions")
		} footer: {
			Text("Toby uses these notes as context for follow-up decisions. Each instruction can be up to 2,000 characters.")
		}
	}

	private func sourceBinding(_ source: FollowupSource) -> Binding<Bool> {
		Binding(
			get: {
				store.configuration.sources[source.id] ?? source.enabled
			},
			set: { store.configuration.sources[source.id] = $0 }
		)
	}

	private func instructionBinding(_ instruction: FollowupInstruction) -> Binding<String> {
		Binding(
			get: { store.instructionDrafts[instruction.id] ?? instruction.text },
			set: { store.instructionDrafts[instruction.id] = String($0.prefix(2000)) }
		)
	}

	private var newInstructionBinding: Binding<String> {
		Binding(
			get: { store.newInstruction },
			set: { store.newInstruction = String($0.prefix(2000)) }
		)
	}

	private func thresholdRow(title: String, value: Binding<Double>) -> some View {
		LabeledContent(title) {
			HStack(spacing: 10) {
				Slider(value: value, in: 0...1, step: 0.05)
					.frame(width: 160)
				Text("\(Int((value.wrappedValue * 100).rounded()))%")
					.monospacedDigit()
					.frame(width: 36, alignment: .trailing)
			}
		}
	}

	private static func readableDate(_ value: String) -> String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		guard let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return value }
		return date.formatted(date: .abbreviated, time: .shortened)
	}

	private static func intervalLabel(_ minutes: Int) -> String {
		if minutes % 60 == 0 {
			let hours = minutes / 60
			return hours == 1 ? "1 hour" : "\(hours) hours"
		}
		return "\(minutes) minutes"
	}
}
