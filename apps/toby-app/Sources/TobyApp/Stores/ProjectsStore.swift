import Foundation
import Observation

@Observable
@MainActor
final class ProjectsStore {
	var projects: [ProjectSummary] = []
	var selectedProjectId: String?
	var selectedProject: ProjectSummary?
	var projectSessions: [String: [SessionSummary]] = [:]
	var tree: [ProjectTreeEntry] = []
	var personaOptions: [PersonaOption] = []
	var isLoading = false
	var isSaving = false
	var hasLoadedOnce = false
	var lastLoadedAt: Date?
	var errorMessage: String?
	var pendingDelete: PendingDelete?
	/// When true, the project route shows the selected project's chat workspace
	/// instead of the project details page.
	var isShowingChat = false
	/// The project-chat Files inspector. Each project chat starts with it open.
	var isFilesSidebarPresented = false
	/// Details / Chats tab on the project page.
	var selectedDetailTab: ProjectDetailTab = .details
	var treeChanges: [ProjectTreeChange] = []
	/// Create / edit sheet draft. Nil when the editor is dismissed.
	var editor: ProjectEditorDraft?
	var editorBaseline: ProjectEditorDraft?
	var editorError: String?

	var isEditorDirty: Bool {
		guard let editor else { return false }
		return editor != editorBaseline
	}

	struct PendingDelete {
		let projectId: String
		let name: String
	}

	private let client = TobyClient()
	@ObservationIgnored
	nonisolated(unsafe)
	private var folderWatchTask: Task<Void, Never>?
	@ObservationIgnored
	nonisolated(unsafe)
	private var clearTreeChangesTask: Task<Void, Never>?
	private var selectedProjectDetailId: String?
	private var treeProjectId: String?

	var selectedProjectName: String {
		selectedProject?.name ?? "Projects"
	}

	var selectedProjectSessions: [SessionSummary] {
		guard let selectedProjectId else { return [] }
		return projectSessions[selectedProjectId] ?? []
	}

	func recentSessions(for projectId: String, limit: Int) -> [SessionSummary] {
		Array(sessions(for: projectId).prefix(limit))
	}

	func metaLine(for project: ProjectSummary) -> String {
		projectMetaLine(
			chatCount: sessions(for: project.id).count,
			personaName: project.personaName,
			options: personaOptions,
		)
	}

	deinit {
		folderWatchTask?.cancel()
		clearTreeChangesTask?.cancel()
	}

	/// Clears projects state after a Toby home directory switch.
	func resetForHomeSwitch() {
		folderWatchTask?.cancel()
		folderWatchTask = nil
		clearTreeChangesTask?.cancel()
		clearTreeChangesTask = nil
		projects = []
		selectedProjectId = nil
		selectedProject = nil
		projectSessions = [:]
		tree = []
		personaOptions = []
		isLoading = false
		isSaving = false
		hasLoadedOnce = false
		lastLoadedAt = nil
		errorMessage = nil
		pendingDelete = nil
		selectedProjectDetailId = nil
		isShowingChat = false
		isFilesSidebarPresented = false
		selectedDetailTab = .details
		treeChanges = []
		treeProjectId = nil
		editor = nil
		editorBaseline = nil
		editorError = nil
	}

	func load() async {
		guard !isLoading else { return }
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			try await loadListData()
			if let selectedProjectId {
				await selectProject(id: selectedProjectId)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func loadList() async {
		guard !isLoading else { return }
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			try await loadListData()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func ensureLoaded() async {
		if hasLoadedOnce {
			if let selectedProjectId, selectedProjectDetailId != selectedProjectId {
				await selectProject(id: selectedProjectId)
			}
			return
		}
		await load()
	}

	func ensureListLoaded() async {
		guard !hasLoadedOnce else { return }
		await loadList()
	}

	func startCreate() {
		let draft = ProjectEditorDraft.blank()
		editor = draft
		editorBaseline = draft
		editorError = nil
	}

	func startEdit() {
		guard let project = selectedProject else { return }
		let draft = ProjectEditorDraft.from(project: project)
		editor = draft
		editorBaseline = draft
		editorError = nil
	}

	func cancelEditor() {
		editor = nil
		editorBaseline = nil
		editorError = nil
	}

	func saveEditor() async {
		guard let draft = editor, draft.canSave else { return }
		isSaving = true
		editorError = nil
		defer { isSaving = false }
		do {
			if let id = draft.existingId {
				let saved = try await client.updateProject(
					id: id,
					name: draft.trimmedName,
					summary: draft.summary,
					personaName: draft.personaName
				)
				applySavedProject(saved)
			} else {
				var created = try await client.createProject(name: draft.trimmedName)
				if !draft.summary.isEmpty || !draft.personaName.isEmpty {
					created = try await client.updateProject(
						id: created.id,
						name: draft.trimmedName,
						summary: draft.summary,
						personaName: draft.personaName
					)
				}
				projects = try await client.listProjects()
				await refreshProjectSessions()
				cancelEditor()
				await selectProject(id: created.id)
				return
			}
			cancelEditor()
		} catch {
			editorError = error.localizedDescription
		}
	}

	private func applySavedProject(_ saved: ProjectSummary) {
		selectedProject = saved
		if let idx = projects.firstIndex(where: { $0.id == saved.id }) {
			projects[idx] = saved
		}
	}

	func deleteProject(id: String, chatStore: ChatStore? = nil) async {
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			try await client.deleteProject(id: id)
			projects = try await client.listProjects()
			await refreshProjectSessions()
			if selectedProjectId == id {
				await selectHome(flush: false)
				await chatStore?.startNewSession()
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	/// Leaves a project chat and shows the selected project's details page
	/// on the Chats tab.
	func showProjectHome() {
		isShowingChat = false
		isFilesSidebarPresented = false
		selectedDetailTab = .chats
	}

	/// Enters a project chat with its live Files inspector visible.
	func showProjectChat() {
		isShowingChat = true
		isFilesSidebarPresented = true
	}

	func selectHome(flush: Bool = true) async {
		_ = flush
		folderWatchTask?.cancel()
		folderWatchTask = nil
		clearTreeChangesTask?.cancel()
		clearTreeChangesTask = nil
		selectedProjectId = nil
		selectedProject = nil
		selectedProjectDetailId = nil
		isShowingChat = false
		isFilesSidebarPresented = false
		selectedDetailTab = .details
		tree = []
		treeChanges = []
		treeProjectId = nil
	}

	/// Selects `id` and loads detail/tree/sessions if needed. Does not change
	/// `isShowingChat` or the details/chats tab — callers that open a chat
	/// must not flash the project page.
	func ensureProjectSelected(id: String) async {
		let alreadyLoaded = selectedProjectId == id && selectedProjectDetailId == id
		selectedProjectId = id
		if alreadyLoaded {
			return
		}
		errorMessage = nil
		if selectedProject?.id != id {
			selectedProject = projects.first { $0.id == id }
		}
		do {
			let detail = try await client.fetchProject(id: id)
			selectedProject = detail.project
			selectedProjectDetailId = id
			projectSessions[id] = detail.sessions ?? []
			tree = try await client.fetchProjectTree(id: id)
			treeProjectId = id
			treeChanges = []
			startFolderWatch(projectId: id)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectProject(id: String) async {
		isShowingChat = false
		isFilesSidebarPresented = false
		selectedDetailTab = .details
		await ensureProjectSelected(id: id)
	}

	func sessions(for projectId: String) -> [SessionSummary] {
		projectSessions[projectId] ?? []
	}

	func createChat(chatStore: ChatStore) async {
		await createChat(for: selectedProjectId, chatStore: chatStore)
	}

	func createChat(for projectId: String?, chatStore: ChatStore) async {
		guard let projectId else { return }
		await ensureProjectSelected(id: projectId)
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			let created = try await client.createProjectSession(projectId: projectId)
			await reloadProjectSessions(projectId: projectId)
			showProjectChat()
			await chatStore.selectSession(id: created.id)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectChat(id: String, chatStore: ChatStore, projectId: String? = nil) async {
		if let projectId {
			await ensureProjectSelected(id: projectId)
		}
		showProjectChat()
		await chatStore.selectSession(id: id)
	}

	func refreshTree() async {
		guard let selectedProjectId else { return }
		do {
			let nextTree = try await client.fetchProjectTree(id: selectedProjectId)
			applyTree(nextTree, projectId: selectedProjectId)
		} catch {
			errorMessage = error.localizedDescription
		}
	}


	private func refreshProjectSessions() async {
		var next: [String: [SessionSummary]] = [:]
		for project in projects {
			do {
				let detail = try await client.fetchProject(id: project.id)
				next[project.id] = detail.sessions ?? []
			} catch {
				next[project.id] = projectSessions[project.id] ?? []
			}
		}
		projectSessions = next
	}

	/// Re-fetch only the persona option list (called when personas change
	/// externally, e.g. via the Persona Editor window).
	func refreshPersonas() async {
		do {
			personaOptions = try await client.listPersonas()
		} catch {
			// Quiet — next full load retries.
		}
	}

	private func loadListData() async throws {
		async let loadedProjects = client.listProjects()
		async let personas = client.listPersonas()
		projects = try await loadedProjects
		personaOptions = try await personas
		await refreshProjectSessions()
		if let selectedProjectId, projects.contains(where: { $0.id == selectedProjectId }) {
			if selectedProjectDetailId != selectedProjectId {
				tree = []
				treeProjectId = nil
				treeChanges = []
			}
			selectedProject = projects.first { $0.id == selectedProjectId }
		} else {
			selectedProjectId = nil
			selectedProject = nil
			tree = []
			treeProjectId = nil
			treeChanges = []
			selectedProjectDetailId = nil
			isShowingChat = false
			isFilesSidebarPresented = false
			selectedDetailTab = .details
		}
		hasLoadedOnce = true
		lastLoadedAt = Date()
	}

	private func reloadProjectSessions(projectId: String) async {
		do {
			let detail = try await client.fetchProject(id: projectId)
			projectSessions[projectId] = detail.sessions ?? []
			if selectedProjectId == projectId {
				selectedProject = detail.project
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	private func startFolderWatch(projectId: String) {
		folderWatchTask?.cancel()
		// Poll less aggressively — a 2s tree refresh was invalidating the project
		// inspector during chat scroll and contributing to main-thread freezes.
		folderWatchTask = Task { [weak self] in
			while !Task.isCancelled {
				try? await Task.sleep(for: .seconds(8))
				await self?.refreshTreeIfStillSelected(projectId: projectId)
			}
		}
	}

	private func refreshTreeIfStillSelected(projectId: String) async {
		guard selectedProjectId == projectId else { return }
		do {
			let nextTree = try await client.fetchProjectTree(id: projectId)
			applyTree(nextTree, projectId: projectId)
		} catch {
			// Folder polling should not replace the user's visible error state.
		}
	}

	private func applyTree(_ nextTree: [ProjectTreeEntry], projectId: String) {
		guard treeProjectId == projectId else {
			tree = nextTree
			treeProjectId = projectId
			treeChanges = []
			return
		}
		guard nextTree != tree else { return }
		let changes = projectTreeChanges(from: tree, to: nextTree)
		tree = nextTree
		guard !changes.isEmpty else { return }
		treeChanges = changes
		scheduleTreeChangeClear()
	}

	private func scheduleTreeChangeClear() {
		clearTreeChangesTask?.cancel()
		clearTreeChangesTask = Task { [weak self] in
			try? await Task.sleep(for: .seconds(6))
			guard !Task.isCancelled else { return }
			self?.clearTreeChanges()
		}
	}

	private func clearTreeChanges() {
		treeChanges = []
		clearTreeChangesTask = nil
	}
}
