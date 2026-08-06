import SwiftUI

struct IntegrationSetupWizardView: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem

	private var guide: IntegrationSetupGuide? {
		store.setupGuide
	}

	private var status: IntegrationStatus? {
		store.integrationStatus[section.key]
	}

	private var isLoading: Bool {
		store.setupGuideLoading == section.key || store.integrationStatusLoading == section.key
	}

	private var actionInProgress: Bool {
		store.integrationActionLoading != nil || store.isSaving
	}

	var body: some View {
		VStack(spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 24) {
					header

					if let guide, guide.ok, let steps = guide.steps, !steps.isEmpty {
						stepsSection(steps: steps)
					} else if let guide, !guide.ok, let error = guide.error {
						errorLabel(error)
					} else if guide == nil, store.setupGuideLoading == nil {
						Text("No setup guide available.")
							.foregroundStyle(AppTheme.secondaryText)
					}

					credentialsSection
					actionSection
				}
				.padding(24)
			}

			Divider()
				.background(SettingsDesign.controlBorder)

			HStack {
				Spacer()
				Button("Close") {
					store.dismissSetupGuide()
				}
				.keyboardShortcut(.escape, modifiers: [])
			}
			.padding(16)
		}
		.frame(minWidth: 620, minHeight: 520)
		.task(id: section.key) {
			await store.loadSetupGuide(for: section.key)
			await store.loadIntegrationStatus(for: section.key)
		}
	}

	@ViewBuilder
	private var header: some View {
		HStack(spacing: 14) {
			RoundedRectangle(cornerRadius: 12)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 48, height: 48)
				.overlay {
					Image(systemName: "puzzlepiece.extension")
						.font(.system(size: 22, weight: .medium))
						.foregroundStyle(AppTheme.accent)
				}
			VStack(alignment: .leading, spacing: 4) {
				Text(guide?.displayName ?? section.label)
					.font(.title3.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				statusLine
			}
			Spacer()
		}
		if let description = guide?.description, !description.isEmpty {
			Text(description)
				.font(.subheadline)
				.foregroundStyle(AppTheme.secondaryText)
				.fixedSize(horizontal: false, vertical: true)
		}
	}

	@ViewBuilder
	private var statusLine: some View {
		if isLoading {
			HStack(spacing: 6) {
				ProgressView()
					.scaleEffect(0.7)
				Text("Loading setup guide…")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}
		} else if let status {
			HStack(spacing: 6) {
				Circle()
					.fill(status.connected ? Color.green : AppTheme.tertiaryText)
					.frame(width: 6, height: 6)
				Text(status.connected ? "Connected" : "Not connected")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}
		}
	}

	private func stepsSection(steps: [IntegrationSetupGuideStep]) -> some View {
		VStack(alignment: .leading, spacing: 20) {
			Text("Setup steps")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)

			ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
				VStack(alignment: .leading, spacing: 10) {
					HStack(alignment: .top, spacing: 10) {
						Text("\(index + 1)")
							.font(.caption.weight(.semibold))
							.foregroundStyle(AppTheme.accent)
							.frame(width: 22, height: 22)
							.background(
								Circle()
									.fill(AppTheme.accent.opacity(0.12))
							)
						Text(step.title)
							.font(.subheadline.weight(.semibold))
							.foregroundStyle(AppTheme.primaryText)
					}
					if let description = step.description, !description.isEmpty {
						Text(description)
							.font(.subheadline)
							.foregroundStyle(AppTheme.secondaryText)
							.fixedSize(horizontal: false, vertical: true)
							.padding(.leading, 32)
					}
					if let links = step.links, !links.isEmpty {
						VStack(alignment: .leading, spacing: 6) {
							ForEach(links) { link in
								Link(destination: URL(string: link.url)!) {
									HStack(spacing: 6) {
										Image(systemName: "link")
											.font(.caption)
										Text(link.label)
											.font(.subheadline)
										Spacer()
									}
								}
								.foregroundStyle(AppTheme.accent)
							}
						}
						.padding(.leading, 32)
					}
					if let artifacts = step.artifacts, !artifacts.isEmpty {
						VStack(alignment: .leading, spacing: 10) {
							ForEach(artifacts) { artifact in
								artifactRow(artifact)
							}
						}
						.padding(.leading, 32)
					}
				}
			}
		}
	}

	private func artifactRow(_ artifact: IntegrationSetupGuideArtifact) -> some View {
		VStack(alignment: .leading, spacing: 6) {
			Text(artifact.label)
				.font(.caption.weight(.medium))
				.foregroundStyle(AppTheme.secondaryText)
			HStack(spacing: 8) {
				Text(artifact.value)
					.font(.subheadline.monospaced())
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(2)
					.textSelection(.enabled)
				Spacer()
				Button("Copy") {
					NSPasteboard.general.clearContents()
					NSPasteboard.general.setString(artifact.value, forType: .string)
				}
				.controlSize(.small)
				.help("Copy to clipboard")
			}
			if let hint = artifact.hint, !hint.isEmpty {
				Text(hint)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.fixedSize(horizontal: false, vertical: true)
			}
		}
		.padding(12)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
				.fill(SettingsDesign.canvasBackground.opacity(0.55))
		)
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
				.stroke(SettingsDesign.controlBorder, lineWidth: 1)
		}
	}

	@ViewBuilder
	private var credentialsSection: some View {
		if store.sectionFieldsReloading == section.key {
			CredentialsSkeletonView(title: "Credentials")
		} else {
			VStack(alignment: .leading, spacing: 16) {
				Text("Credentials")
					.font(.headline)
					.foregroundStyle(AppTheme.primaryText)

				let fields = store.detailFields(for: section)
				let rowFields = fields.filter { field in
					field.kind != .hint && field.multiline != true && field.readOnly != true
				}
				let blockFields = fields.filter { field in
					field.multiline == true || field.kind == .hint || field.readOnly == true
				}

				if !rowFields.isEmpty {
					SettingsCard {
						ForEach(Array(rowFields.enumerated()), id: \.element.id) { index, field in
							ConfigureFieldRowView(
								store: store,
								field: field,
								sectionLabel: section.label,
								showsDivider: index < rowFields.count - 1,
							)
						}
					}
				}

				ForEach(blockFields) { field in
					ConfigureBlockFieldView(
						store: store,
						field: field,
						sectionLabel: section.label,
					)
				}
			}
		}
	}

	@ViewBuilder
	private var actionSection: some View {
		VStack(alignment: .leading, spacing: 12) {
			Text("Actions")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)

			HStack(spacing: 10) {
				if let status, status.connected {
					SettingsActionButton(title: "Disconnect") {
						Task { await store.runIntegrationAction(name: section.key, action: .disconnect) }
					}
					.disabled(actionInProgress)
					SettingsActionButton(title: status.reconnectionLabel) {
						Task { await store.runIntegrationAction(name: section.key, action: .reauthorize) }
					}
					.disabled(actionInProgress)
				} else {
					SettingsActionButton(title: "Connect") {
						Task { await store.runIntegrationAction(name: section.key, action: .connect) }
					}
					.disabled(actionInProgress)
				}
			}
		}
	}

	private func errorLabel(_ message: String) -> some View {
		InlineStatusMessage(message: message, tone: .error)
	}
}
