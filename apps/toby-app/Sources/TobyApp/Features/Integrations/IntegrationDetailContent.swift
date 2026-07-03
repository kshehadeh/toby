import SwiftUI

struct IntegrationDetailContent: View {
    @Bindable var store: ConfigureStore
    let section: SettingsItem
    @State private var isSetupGuideExpanded = false

    private var status: IntegrationStatus? {
        store.integrationStatus[section.key]
    }

    private var isStatusLoading: Bool {
        store.integrationStatusLoading == section.key
    }

    private var isActionLoading: Bool {
        store.integrationActionLoading != nil
    }

    private var guide: IntegrationSetupGuide? {
        store.setupGuide
    }

    private var isGuideLoading: Bool {
        store.setupGuideLoading == section.key
    }

    private var fields: [SettingsItem] {
        store.detailFields(for: section)
    }

    private var mainFields: [SettingsItem] {
        fields.filter { $0.kind != .delete }
    }

    private var rowFields: [SettingsItem] {
        mainFields.filter { field in
            field.multiline != true
                && field.kind != .hint
                && field.kind != .image
                && !(field.readOnly == true && field.kind != .action)
        }
    }

    private var blockFields: [SettingsItem] {
        mainFields.filter { field in
            !rowFields.contains(where: { $0.id == field.id })
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            IntegrationDetailHeaderView(
                section: section,
                status: status,
                isLoading: isStatusLoading,
            )
            .padding(.horizontal, 24)
            .padding(.vertical, 18)

            Divider().overlay(SettingsDesign.cardBorder)

            HStack(spacing: 0) {
                mainColumn
                Divider().overlay(SettingsDesign.cardBorder)
                IntegrationInspectorSidebar(
                    store: store,
                    section: section,
                    status: status,
                    isActionLoading: isActionLoading,
                    onAction: { action in
                        Task {
                            await store.runIntegrationAction(name: section.key, action: action)
                        }
                    },
                )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: section.key) {
            await store.loadIntegrationStatus(for: section.key)
            await store.loadSetupGuide(for: section.key)
        }
    }

    private var mainColumn: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                descriptionSection
                setupGuideSection
                credentialsSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private var descriptionSection: some View {
        if let description = status?.description ?? guide?.description, !description.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("About")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(SettingsDesign.rowTitle)
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private var setupGuideSection: some View {
        if isGuideLoading {
            HStack(spacing: 8) {
                ProgressView().scaleEffect(0.7)
                Text("Loading setup guide…")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.secondaryText)
            }
        } else if let guide, guide.ok, let steps = guide.steps, !steps.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isSetupGuideExpanded.toggle()
                    }
                } label: {
                    HStack(spacing: 8) {
                        Text("Setup Guide")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(SettingsDesign.rowTitle)
                        Spacer()
                        Image(systemName: isSetupGuideExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 10))
                            .foregroundStyle(AppTheme.tertiaryText)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isSetupGuideExpanded ? "Collapse setup guide" : "Expand setup guide")

                if isSetupGuideExpanded {
                    VStack(alignment: .leading, spacing: 16) {
                        ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                            setupStepRow(index: index, step: step)
                        }
                    }
                    .padding(.top, 12)
                }
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
                    .fill(SettingsDesign.cardBackground)
            )
            .overlay {
                RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
                    .stroke(SettingsDesign.cardBorder, lineWidth: 1)
            }
        } else if let guide, !guide.ok, let error = guide.error {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(Color.red)
                Text(error)
                    .font(.subheadline)
                    .foregroundStyle(Color.red.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
                    .fill(Color.red.opacity(0.08))
            )
        }
    }

    private func setupStepRow(index: Int, step: IntegrationSetupGuideStep) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Text("\(index + 1)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.accent)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(AppTheme.accent.opacity(0.12)))
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
                    ForEach(Array(links.enumerated()), id: \.offset) { _, link in
                        Link(destination: URL(string: link.url)!) {
                            HStack(spacing: 6) {
                                Image(systemName: "link").font(.caption)
                                Text(link.label)
                                    .font(.subheadline)
                                    .lineLimit(2)
                                    .fixedSize(horizontal: false, vertical: true)
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
            CredentialsSkeletonView()
        } else if !rowFields.isEmpty || !blockFields.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                Text("Configuration")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(SettingsDesign.rowTitle)

                ForEach(Array(groupedRowFields.enumerated()), id: \.offset) { _, group in
                    VStack(alignment: .leading, spacing: 8) {
                        if let groupName = group.name {
                            Text(groupName)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(SettingsDesign.rowDescription)
                        }
                        SettingsCard {
                            ForEach(Array(group.fields.enumerated()), id: \.element.id) { index, field in
                                ConfigureFieldRowView(
                                    store: store,
                                    field: field,
                                    sectionLabel: section.label,
                                    showsDivider: index < group.fields.count - 1,
                                )
                            }
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

    private struct FieldGroup {
        let name: String?
        let fields: [SettingsItem]
    }

    private var groupedRowFields: [FieldGroup] {
        let grouped = Dictionary(grouping: rowFields, by: { $0.group })
        let groupNames = grouped.keys.compactMap { $0 }.sorted()
        var result: [FieldGroup] = []
        for name in groupNames {
            if let fields = grouped[name] {
                result.append(FieldGroup(name: name, fields: fields))
            }
        }
        if let ungrouped = grouped[nil] {
            result.append(FieldGroup(name: nil, fields: ungrouped))
        }
        return result
    }
}
