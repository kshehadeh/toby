import SwiftUI
import UniformTypeIdentifiers

struct SkillDetailContent: View {
	@Bindable var store: SkillsStore
	let skill: SkillDetail

	@State private var isIconPickerPresented = false

	var body: some View {
		// `AnyLayout` keeps one markdown-editor subtree alive while adapting.
		// `ViewThatFits` would measure two separate AppKit editor instances.
		GeometryReader { proxy in
			let isCompact = proxy.size.width < FeatureBrowserMetrics.narrowThreshold
			let layout = isCompact
				? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
				: AnyLayout(HStackLayout(alignment: .top, spacing: 20))

			layout {
				ScrollView {
					aboutCard
				}
				.frame(
					minWidth: isCompact ? nil : 280,
					idealWidth: isCompact ? nil : 320,
					maxWidth: isCompact ? .infinity : 380,
					maxHeight: isCompact ? 260 : .infinity,
					alignment: .top
				)

				instructionsColumn
					.frame(
						minWidth: isCompact ? nil : 320,
						maxWidth: .infinity,
						maxHeight: .infinity,
						alignment: .top
					)
			}
			.padding(28)
			.frame(maxWidth: 1100, maxHeight: .infinity, alignment: .top)
			.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
		.background(SettingsDesign.canvasBackground)
		.fileImporter(
			isPresented: $isIconPickerPresented,
			allowedContentTypes: [.png, .jpeg, .image],
			allowsMultipleSelection: false,
		) { result in
			handleIconPickerResult(result)
		}
	}

	private var aboutCard: some View {
		VStack(alignment: .leading, spacing: 16) {
			Text("About")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)

			HStack(alignment: .center, spacing: 12) {
				EditableSkillIcon(
					iconURL: skill.resolvedIconURL,
					hasCustomIcon: skill.iconUrl != nil,
					isDisabled: store.isSaving,
					onChoose: { isIconPickerPresented = true },
					onReset: { Task { await store.resetIcon() } },
				)
				VStack(alignment: .leading, spacing: 2) {
					Text("Icon")
						.font(.system(size: 12, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
					Text("Click to change. Reset a custom icon from the context menu.")
						.font(.system(size: 11))
						.foregroundStyle(SettingsDesign.rowDescription)
				}
			}

			SkillSidebarField(
				title: "Name",
				placeholder: "Skill name",
				accessibilityIdentifier: "skill-title-field",
				text: nameBinding,
			)

			SkillSidebarField(
				title: "Summary",
				hint: "Used to display and choose this skill",
				placeholder: "What this skill does and when to use it",
				axis: .vertical,
				text: binding(for: .summary),
			)
			enableRow
			metadataSection
		}
		.padding(18)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		)
	}

	private var instructionsColumn: some View {
		VStack(alignment: .leading, spacing: 8) {
			VStack(alignment: .leading, spacing: 4) {
				Text("Instructions")
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text("Sent to the model when this skill runs")
					.font(.caption)
					.foregroundStyle(SettingsDesign.rowDescription)
			}
			SkillMarkdownEditor(text: binding(for: .body))
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}

	private var enableRow: some View {
		HStack {
			VStack(alignment: .leading, spacing: 2) {
				Text("Enabled")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text(
					enabledBinding.wrappedValue
						? "Offered to the model"
						: "Hidden from the model"
				)
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

	private var nameBinding: Binding<String> {
		Binding(
			get: { store.value(for: store.key(for: skill.dirName, field: .name)) },
			set: {
				store.setDraftValue(
					store.key(for: skill.dirName, field: .name),
					$0,
					autosaveImmediately: true,
				)
			},
		)
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

extension SkillDetail {
	/// Full URL for the skill's custom icon, with a cache-busting token so
	/// re-uploads (which reuse the `icon.png` filename) reload in the UI.
	var resolvedIconURL: URL? {
		guard let iconUrl, !iconUrl.isEmpty else { return nil }
		let base = ConfigReader.baseURL().absoluteString
		let token = (updatedAt ?? "")
			.unicodeScalars
			.filter { CharacterSet.alphanumerics.contains($0) }
			.map(String.init)
			.joined()
		let suffix = token.isEmpty ? "" : "?v=\(token)"
		return URL(string: base + iconUrl + suffix)
	}
}
