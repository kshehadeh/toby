import SwiftUI
import UniformTypeIdentifiers

struct SkillInspectorSidebar: View {
	@Bindable var store: SkillsStore
	let skill: SkillDetail

	@State private var isIconPickerPresented = false

	var body: some View {
		VStack(spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 18) {
					iconSection
					SkillSidebarField(
						title: "Name",
						placeholder: "Skill name",
						text: binding(for: .name),
					)
					SkillSidebarField(
						title: "Description",
						placeholder: "Short description",
						axis: .vertical,
						text: binding(for: .description),
					)
					SkillSidebarField(
						title: "Summary",
						hint: "Optional",
						placeholder: "Shown in the skill picker",
						axis: .vertical,
						text: binding(for: .summary),
					)
					enableRow
					Divider().overlay(SettingsDesign.cardBorder)
					metadataSection
				}
				.padding(18)
			}

			Divider().overlay(SettingsDesign.cardBorder)

			Button(role: .destructive) {
				store.pendingDelete = SkillsStore.PendingDelete(
					dirName: skill.dirName,
					name: skill.name,
				)
			} label: {
				Label("Delete Skill…", systemImage: "trash")
					.frame(maxWidth: .infinity)
			}
			.buttonStyle(.bordered)
			.controlSize(.regular)
			.tint(.red)
			.disabled(store.isSaving)
			.padding(18)
			.accessibilityIdentifier("sidebar-delete-skill-button")
		}
		.frame(width: 280)
		.background(AppTheme.sidebarBackground)
		.fileImporter(
			isPresented: $isIconPickerPresented,
			allowedContentTypes: [.png, .jpeg, .image],
			allowsMultipleSelection: false,
		) { result in
			handleIconPickerResult(result)
		}
	}

	private var iconSection: some View {
		HStack(spacing: 14) {
			SkillIconView(iconURL: skill.resolvedIconURL, size: 56, cornerRadius: 13)
			VStack(alignment: .leading, spacing: 8) {
				HStack(spacing: 8) {
					SettingsActionButton(title: "Change…", showsExternalIcon: false) {
						isIconPickerPresented = true
					}
					.disabled(store.isSaving)
					if skill.iconUrl != nil {
						Button("Reset") {
							Task { await store.resetIcon() }
						}
						.buttonStyle(.borderless)
						.font(.system(size: 12))
						.foregroundStyle(SettingsDesign.rowDescription)
						.disabled(store.isSaving)
					}
				}
			}
			Spacer(minLength: 0)
		}
	}

	private var enableRow: some View {
		HStack {
			VStack(alignment: .leading, spacing: 2) {
				Text("Enabled")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text(skill.enabled ? "Offered to the model" : "Hidden from the model")
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
			}
			Spacer()
			SettingsToggle(isOn: enabledBinding)
		}
	}

	private var metadataSection: some View {
		VStack(alignment: .leading, spacing: 8) {
			if let created = formattedDate(skill.createdAt) {
				metadataRow(label: "Created", value: created)
			}
			if let edited = formattedDate(skill.updatedAt) {
				metadataRow(label: "Edited", value: edited)
			}
		}
	}

	private func metadataRow(label: String, value: String) -> some View {
		HStack {
			Text(label)
				.font(.system(size: 11))
				.foregroundStyle(SettingsDesign.rowDescription)
			Spacer()
			Text(value)
				.font(.system(size: 11))
				.foregroundStyle(SettingsDesign.rowTitle)
		}
	}

	private func binding(for field: SkillField) -> Binding<String> {
		Binding(
			get: { store.value(for: store.key(for: skill.dirName, field: field)) },
			set: { store.setDraftValue(store.key(for: skill.dirName, field: field), $0) },
		)
	}

	private var enabledBinding: Binding<Bool> {
		Binding(
			get: {
				store.value(for: store.key(for: skill.dirName, field: .enabled)) == "true"
			},
			set: {
				store.setDraftValue(
					store.key(for: skill.dirName, field: .enabled),
					$0 ? "true" : "false",
					autosaveImmediately: true,
				)
			},
		)
	}

	private func formattedDate(_ iso: String?) -> String? {
		guard let iso, !iso.isEmpty else { return nil }
		let parser = ISO8601DateFormatter()
		parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
		guard let date else { return nil }
		let formatter = DateFormatter()
		formatter.dateStyle = .medium
		formatter.timeStyle = .short
		return formatter.string(from: date)
	}

	private func handleIconPickerResult(_ result: Result<[URL], Error>) {
		switch result {
		case .success(let urls):
			guard let url = urls.first else { return }
			Task {
				do {
					let accessed = url.startAccessingSecurityScopedResource()
					defer {
						if accessed { url.stopAccessingSecurityScopedResource() }
					}
					let data = try Data(contentsOf: url)
					await store.uploadIcon(fileData: data, filename: url.lastPathComponent)
				} catch {
					store.errorMessage = error.localizedDescription
				}
			}
		case .failure(let error):
			store.errorMessage = error.localizedDescription
		}
	}
}
