import Foundation
import TobyAI
import TobyCore
import TobyMail

enum TobyClientError: LocalizedError {
	case invalidResponse
	case serverError(String)
	case streamError(String)
	/// Gateway account cannot pay for the request. The persistent banner is posted separately.
	case gatewayFunds(String)

	var errorDescription: String? {
		switch self {
		case .invalidResponse:
			return "Invalid response from Toby."
		case .serverError(let message), .streamError(let message), .gatewayFunds(let message):
			return message
		}
	}
}

@MainActor
struct TobyClient {
	/// In-process API over the native services (`NativeRuntime`).
	init() {}

	func fetchStatus() async throws -> AppStatus {
		return try JSONDecoder().decode(AppStatus.self, from: Data(NativeStatusRouter.appStatus().jsonString().utf8))
	}

	func fetchDaemonStatus() async throws -> DaemonStatus {
		return try JSONDecoder().decode(DaemonStatus.self, from: Data(await NativeStatusRouter.daemonStatus().jsonString().utf8))
	}

	func listSessions(limit: Int = 20) async throws -> [SessionSummary] {
		struct Payload: Decodable { let sessions: [SessionSummary] }
		return try JSONDecoder().decode(Payload.self, from: try NativeRuntime.shared.chat().list(limit: limit)).sessions
	}

	func listPersonas() async throws -> [PersonaOption] {
		struct Payload: Decodable { let personas: [PersonaOption] }
		return try JSONDecoder().decode(Payload.self, from: try NativeRuntime.shared.files().personaList()).personas
	}

	func fetchPersonaDetail(name: String) async throws -> PersonaDetail {
		return try JSONDecoder().decode(PersonaDetailResponse.self, from: try NativeRuntime.shared.files().personaDetail(name)).persona
	}

	func fetchAIProviders() async throws -> [AIProviderInfo] {
		return try JSONDecoder().decode(AIProvidersResponse.self, from: Data(await NativeStatusRouter.providers().jsonString().utf8)).providers
	}

	/// Complete guided setup (`POST …/setup`) with open-ended `fields`.
	func setupAIProvider(
		providerId: String,
		fields: [String: String],
		model: String? = nil,
	) async throws -> AIProviderSetupResponse {
		// OpenRouter only: store the key and confirm it answers with a balance.
		guard providerId == "openrouter" else { throw TobyClientError.serverError("Toby uses OpenRouter for AI.") }
		if let key = fields["apiKey"]?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty { try KeychainKeyStore().save(key) }
		let credits = try await NativeRuntime.shared.ai.credits()
		if let model { UserDefaults.standard.set(model, forKey: AccountSettingsModel.chatModelKey) }
		let payload: JSONValue = ["ok": true, "providerId": "openrouter", "model": model.map(JSONValue.string) ?? .null, "configured": true,
		                          "remaining": .number(credits.totalCredits - credits.totalUsage), "totalSpent": .number(credits.totalUsage)]
		return try JSONDecoder().decode(AIProviderSetupResponse.self, from: Data(payload.jsonString().utf8))
	}

	func createPersona(
		name: String,
		instructions: String,
		model: String,
		promptMode: String,
	) async throws -> ConfigureActionResponse {
		try await runConfigureAction(
			"create-persona",
			body: [
				"name": name,
				"instructions": instructions,
				"model": model,
				"promptMode": promptMode,
			],
		)
	}

	func updatePersona(
		originalName: String,
		name: String?,
		instructions: String?,
		model: String?,
		promptMode: String?,
	) async throws -> ConfigureActionResponse {
		var body: [String: String] = ["originalName": originalName]
		if let name { body["name"] = name }
		if let instructions { body["instructions"] = instructions }
		if let model { body["model"] = model }
		if let promptMode { body["promptMode"] = promptMode }
		return try await runConfigureAction("update-persona", body: body)
	}

	func fetchSession(id: String) async throws -> SessionDetail {
		return try JSONDecoder().decode(SessionDetail.self, from: try NativeRuntime.shared.chat().detail(id))
	}

	func createSession(persona: String? = nil) async throws -> CreateSessionResponse {
		return try JSONDecoder().decode(CreateSessionResponse.self, from: try NativeRuntime.shared.chat().create(persona: persona))
	}

	func listProjects() async throws -> [ProjectSummary] {
		return try JSONDecoder().decode(ProjectsListResponse.self, from: try NativeRuntime.shared.files().projectList()).projects
	}

	func fetchProject(id: String) async throws -> ProjectDetailResponse {
		return try JSONDecoder().decode(ProjectDetailResponse.self, from: try NativeRuntime.shared.files().project(id))
	}

	func createProject(name: String = "New project") async throws -> ProjectSummary {
		return try JSONDecoder().decode(ProjectMutationResponse.self, from: try NativeRuntime.shared.files().createProject(name: name)).project
	}

	func updateProject(
		id: String,
		name: String? = nil,
		summary: String? = nil,
		personaName: String? = nil,
		folderPath: String? = nil,
	) async throws -> ProjectSummary {
		let data = try NativeRuntime.shared.files().updateProject(id, name: name, summary: summary, personaName: personaName, folderPath: folderPath)
		return try JSONDecoder().decode(ProjectMutationResponse.self, from: data).project
	}

	func deleteProject(id: String) async throws {
		try NativeRuntime.shared.files().deleteProject(id)
		return
	}

	func fetchProjectTree(id: String) async throws -> [ProjectTreeEntry] {
		return try JSONDecoder().decode(ProjectTreeResponse.self, from: try NativeRuntime.shared.files().projectTree(id)).tree
	}

	func createProjectSession(projectId: String) async throws -> SessionSummary {
		return try JSONDecoder().decode(ProjectSessionResponse.self, from: try NativeRuntime.shared.files().createProjectSession(projectId)).session
	}

	func deleteSession(id: String) async throws {
		try NativeRuntime.shared.chat().delete(id)
		return
	}

	func listRecordings() async throws -> [ListenRecordingSummary] { return try JSONDecoder().decode(ListenRecordingsListResponse.self, from: try await NativeRuntime.shared.listen().list()).recordings
	}

	func fetchRecording(id: String) async throws -> ListenRecordingDetail { return try await Self.decodeRecordingDetail(try await NativeRuntime.shared.listen().detail(id))
	}

	func updateRecording(id: String, name: String?) async throws -> ListenRecordingDetail { return try await Self.decodeRecordingDetail(try await NativeRuntime.shared.listen().update(id, name: name ?? "", chatSessionID: nil))
	}

	func updateRecordingChatSession(id: String, chatSessionId: String?) async throws -> ListenRecordingDetail {
		return try await Self.decodeRecordingDetail(try await NativeRuntime.shared.listen().update(id, name: nil, chatSessionID: chatSessionId.map(JSONValue.string) ?? .null))
	}

	func deleteRecording(id: String) async throws { try await NativeRuntime.shared.listen().delete(id); return
	}

	/// Delete a recording's audio files (keeps the transcript, summary, and metadata).
	func deleteRecordingAudio(id: String) async throws -> ListenRecordingDetail { return try await Self.decodeRecordingDetail(try await NativeRuntime.shared.listen().deleteAudio(id))
	}

	func parseCronExpression(input: String) async throws -> String { return try await NativeRuntime.shared.flows().parseCron(input)
	}

	func transcribeRecording(id: String) async throws -> ListenRecordingDetail { return try await Self.decodeRecordingDetail(try await NativeRuntime.shared.listen().transcribe(id, reuseLiveTranscript: false) { _ in })
	}

	func summarizeRecording(id: String) async throws -> ListenRecordingDetail { return try await Self.decodeRecordingDetail(try await NativeRuntime.shared.listen().summarize(id))
	}

	func streamTranscribeRecording(
		id: String,
		reuseLiveTranscript: Bool = false,
		onStatus: @escaping (String) -> Void,
	) async throws -> ListenRecordingDetail {
		let relay = StatusRelay(onStatus)
		let data = try await NativeRuntime.shared.listen().transcribe(id, reuseLiveTranscript: reuseLiveTranscript) { message in relay.send(message) }
		return try await Self.decodeRecordingDetail(data)
	}

	func streamTurn(
		sessionId: String,
		text: String,
		attachments: [ChatAttachmentDraft] = [],
		saveAttachmentsToProject: Bool = false,
		clientTurnId: String? = nil,
		onEvent: @escaping (ChatEventPayload) -> Void,
		onAskUser: ((AskUserPromptPayload) async -> (selectedIndex: Int, selectedLabel: String, rawInput: String, error: String?))?,
		onPosted: (@MainActor () -> Void)? = nil,
	) async throws -> TurnDonePayload {
		return try await streamNativeTurn(
			sessionId: sessionId, text: text, attachments: attachments, clientTurnId: clientTurnId,
			onEvent: onEvent, onAskUser: onAskUser, onPosted: onPosted,
		)
	}

	func cancelTurn(sessionId: String, turnId: String) async {
		guard let router = try? NativeRuntime.shared.chat() else { return }
		await router.cancel(turnID: turnId)
		return
	}

	/// Decode off the main actor so large transcripts / timed segments do not freeze the UI.
	nonisolated private static func decodeRecordingDetail(_ data: Data) async throws -> ListenRecordingDetail {
		try await Task.detached(priority: .userInitiated) {
			try JSONDecoder().decode(ListenRecordingDetail.self, from: data)
		}.value
	}

	/// Posts the persistent funds banner when `json` carries that code, then
	/// returns the error the caller should throw.
	private func errorFromJSON(
		_ json: [String: Any]?,
		fallback: String,
		asStream: Bool
	) -> TobyClientError {
		if let json {
			GatewayFundsNotice.post(from: json)
			if GatewayFundsNotice(json: json) != nil, let message = json["error"] as? String {
				return .gatewayFunds(message)
			}
			if let error = json["error"] as? String {
				return asStream ? .streamError(error) : .serverError(error)
			}
		}
		return asStream ? .streamError(fallback) : .serverError(fallback)
	}

	func createIssue(type: String, details: String) async throws -> CreateIssueResponse {
		let version = NativeStatusRouter.version
		return try JSONDecoder().decode(CreateIssueResponse.self, from: Data(IssueReport.fallback(type: type, details: details, version: version).jsonString().utf8))
	}

	func discoverIntegrationSettings(name: String, email: String) async throws -> EmailDiscoverResponse {
		do {
			guard let result = await MailDiscovery.discover(email) else {
				throw TobyClientError.serverError("Enter a valid email address, such as name@example.com.")
			}
			var body: [String: Any] = [
				"ok": true, "email": result.email, "domain": result.domain, "source": result.source,
				"settings": try JSONSerialization.jsonObject(with: JSONEncoder().encode(result.settings)),
			]
			if let provider = result.providerName { body["providerName"] = provider }
			if let appPassword = result.appPasswordRequired { body["appPasswordRequired"] = appPassword }
			if let docs = result.documentationURL { body["documentationUrl"] = docs }
			return try JSONDecoder().decode(EmailDiscoverResponse.self, from: JSONSerialization.data(withJSONObject: body))
		}
	}

	func listSkills() async throws -> [SkillListItem] {
		struct Payload: Decodable { let skills: [SkillListItem] }
		return try JSONDecoder().decode(Payload.self, from: try NativeRuntime.shared.files().skillList()).skills
	}

	// MARK: - Flows

	func listFlows() async throws -> [FlowListItem] {
		struct Payload: Decodable { let flows: [FlowListItem] }
		return try JSONDecoder().decode(Payload.self, from: try await NativeRuntime.shared.flows().list()).flows
	}

	func listFlowRuns(flowName: String? = nil, limit: Int = 50, offset: Int = 0) async throws -> [FlowRunSummary] {
		struct Payload: Decodable { let runs: [FlowRunSummary] }
		return try JSONDecoder().decode(Payload.self, from: try await NativeRuntime.shared.flows().runs(flowName: flowName, limit: limit, offset: offset)).runs
	}

	func fetchFlowRun(id: String) async throws -> FlowRunDetail {
		struct Payload: Decodable { let run: FlowRunDetail }
		return try JSONDecoder().decode(Payload.self, from: try await NativeRuntime.shared.flows().runDetail(id)).run
	}

	func fetchFlowCatalog() async throws -> FlowToolCatalog { return try FlowToolCatalog.parse(try await NativeRuntime.shared.flows().catalog())
	}

	func fetchFlowDocument(id: String) async throws -> FlowDocumentPayload {
		struct Payload: Decodable { let document: FlowDocumentPayload }
		return try JSONDecoder().decode(Payload.self, from: try await NativeRuntime.shared.flows().detail(id)).document
	}

	func createFlow(body: [String: Any]) async throws -> FlowMutationResponse {
		let data = try JSONSerialization.data(withJSONObject: body)
		return try JSONDecoder().decode(FlowMutationResponse.self, from: try await NativeRuntime.shared.flows().save(data, id: nil))
	}

	func updateFlow(id: String, body: [String: Any]) async throws -> FlowMutationResponse {
		let data = try JSONSerialization.data(withJSONObject: body)
		return try JSONDecoder().decode(FlowMutationResponse.self, from: try await NativeRuntime.shared.flows().save(data, id: id))
	}

	func deleteFlow(id: String) async throws { try await NativeRuntime.shared.flows().delete(id); return
	}

	func runFlow(id: String, source: String = "manual", triggerId: String? = nil) async throws -> FlowRunNowResponse {
		let data = try await NativeRuntime.shared.flows().runNow(id, source: source, triggerID: triggerId)
		if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { GatewayFundsNotice.post(from: json) }
		return try JSONDecoder().decode(FlowRunNowResponse.self, from: data)
	}

	func fetchSkill(dirName: String) async throws -> SkillDetail {
		struct Payload: Decodable { let skill: SkillDetail }
		return try JSONDecoder().decode(Payload.self, from: try NativeRuntime.shared.files().skillDetail(dirName)).skill
	}

	func fetchChangelog(limit: Int = 10) async throws -> ChangelogResponse {
		return try JSONDecoder().decode(ChangelogResponse.self, from: Data(try await Changelog.fetch(limit: limit).jsonString().utf8))
	}

	/// Query unified log entries via the daemon (`GET /api/logs`).
	func fetchLogs(
		source: String? = nil,
		level: String? = nil,
		category: String? = nil,
		type: String? = nil,
		query: String? = nil,
		limit: Int = 100
	) async throws -> LogsListResponse {
		let result = TobyLog.shared.query(.init(source: source, level: level, category: category, type: type, query: query, limit: limit))
		return try LogsListParser.parse(Data(result.jsonString().utf8))
	}

	// MARK: - Home (Actions + The Feed)

	func fetchFlowDashboardBlocks() async throws -> [FlowDashboardBlockInfo] {
		struct Payload: Decodable { let blocks: [FlowDashboardBlockInfo] }
		let writer = try NativeRuntime.shared.store().writer
		let blocks = try await writer.read { db in try FlowDocuments.dashboardBlocks(db) }
		return try JSONDecoder().decode(Payload.self, from: Data(blocks.jsonString().utf8)).blocks
	}

	/// The Feed: ranked cross-connection items with reasons and actions.
	/// - Parameter fresh: When true, re-collects and re-ranks on the daemon.
	func fetchDashboardFeed(fresh: Bool = false) async throws -> FeedContent {
		do {
			return try JSONDecoder().decode(FeedContent.self, from: try await NativeRuntime.shared.feed().content(fresh: fresh))
		} catch {
			if let notice = GatewayFundsNotice(error: error, activity: "update Home") { GatewayFundsNotice.post(notice) }
			throw error
		}
	}

	/// Runs a Feed tool / local action (`POST /api/dashboard/feed/actions`).
	func performFeedAction(itemID: String, actionID: String) async throws -> FeedActionResponse {
		return try JSONDecoder().decode(FeedActionResponse.self, from: try await NativeRuntime.shared.feed().perform(itemID: itemID, actionID: actionID))
	}

	/// Every action a Feed item supports, including ones its row doesn't show.
	func fetchFeedItemActions(itemID: String) async throws -> [FeedAction] {
		struct Payload: Decodable { let actions: [FeedAction] }
		return try JSONDecoder().decode(Payload.self, from: try await NativeRuntime.shared.feed().actions(itemID: itemID)).actions
	}

	// MARK: - Feed instructions

	/// The user's Feed instructions, oldest first.
	func listFeedInstructions() async throws -> [FeedInstruction] {
		return try JSONDecoder().decode(FeedInstructionsResponse.self, from: try await NativeRuntime.shared.feed().instructions()).instructions
	}

	func addFeedInstruction(text: String) async throws -> [FeedInstruction] {
		return try JSONDecoder().decode(FeedInstructionsResponse.self, from: try await NativeRuntime.shared.feed().addInstruction(text)).instructions
	}

	func setFeedInstructionEnabled(id: String, enabled: Bool) async throws -> [FeedInstruction] {
		return try JSONDecoder().decode(FeedInstructionsResponse.self, from: try await NativeRuntime.shared.feed().setInstruction(id, enabled: enabled)).instructions
	}

	func deleteFeedInstruction(id: String) async throws -> [FeedInstruction] {
		return try JSONDecoder().decode(FeedInstructionsResponse.self, from: try await NativeRuntime.shared.feed().removeInstruction(id)).instructions
	}

	// MARK: - Memories

	func listMemories(limit: Int = 50, offset: Int = 0, query: String? = nil) async throws -> MemoriesListResponse {
		let data = try await NativeRuntime.shared.memories().list(limit: limit, offset: offset, query: query)
		return try JSONDecoder().decode(MemoriesListResponse.self, from: data)
	}

	func fetchMemory(id: String) async throws -> MemoryItem {
		return try JSONDecoder().decode(MemoryDetailResponse.self, from: try NativeRuntime.shared.memories().get(id)).memory
	}

	func createMemory(_ request: MemoryCreateRequest) async throws -> MemoryItem {
		let data = try await NativeRuntime.shared.memories().create(try JSONEncoder().encode(request))
		return try JSONDecoder().decode(MemoryDetailResponse.self, from: data).memory
	}

	func patchMemory(id: String, patch: MemoryPatchRequest) async throws -> MemoryItem {
		let data = try await NativeRuntime.shared.memories().patch(id, try JSONEncoder().encode(patch))
		return try JSONDecoder().decode(MemoryDetailResponse.self, from: data).memory
	}

	func deleteMemory(id: String) async throws {
		try NativeRuntime.shared.memories().delete(id)
		return
	}

	// MARK: - Library

	func listLibraryItems(
		limit: Int = 50,
		offset: Int = 0,
		query: String? = nil,
		origin: String? = nil,
		refreshCatalog: Bool = false
	) async throws -> LibraryListResponse {
		let data = try await NativeRuntime.shared.library().list(limit: limit, offset: offset, query: query, origin: origin, refresh: refreshCatalog)
		return try JSONDecoder().decode(LibraryListResponse.self, from: data)
	}

	func fetchLibraryItem(id: String) async throws -> LibraryAsset {
		return try JSONDecoder().decode(LibraryDetailResponse.self, from: try NativeRuntime.shared.library().get(id)).item
	}

	func createLibraryItem(_ request: LibraryCreateRequest) async throws -> LibraryCreateResponse {
		return try JSONDecoder().decode(LibraryCreateResponse.self, from: try await NativeRuntime.shared.library().create(try JSONEncoder().encode(request)))
	}

	func patchLibraryItem(id: String, patch: LibraryPatchRequest) async throws -> LibraryAsset {
		return try JSONDecoder().decode(LibraryDetailResponse.self, from: try await NativeRuntime.shared.library().patch(id, try JSONEncoder().encode(patch))).item
	}

	func deleteLibraryItem(id: String) async throws {
		try NativeRuntime.shared.library().delete(id)
		return
	}

	/// Create a password-encrypted complete backup (binary archive stream).
	func createConfigBackup(password: String) async throws -> ConfigBackupCreateResponse {
		let service = try NativeRuntime.shared.backups()
		let url = FileManager.default.temporaryDirectory.appending(path: BackupService.fileName())
		_ = try await Task.detached(priority: .userInitiated) { try service.create(password: password, to: url) }.value
		return ConfigBackupCreateResponse(backupData: Data(), suggestedFileName: url.lastPathComponent, fileURL: url)
	}

	/// Restore Toby data from a backup file (v3 archive or legacy JSON envelope).
	func restoreConfigBackup(backupData: Data, password: String?, confirm: Bool = true) async throws {
		let service = try NativeRuntime.shared.backups()
		let url = FileManager.default.temporaryDirectory.appending(path: "toby-restore-\(UUID().uuidString).tbybak")
		try backupData.write(to: url)
		defer { try? FileManager.default.removeItem(at: url) }
		try await Task.detached(priority: .userInitiated) { _ = try service.restore(file: url, password: password ?? "") }.value
		NativeRuntime.shared.relaunchToApplyRestore()
		return
	}

	func fetchConfigSyncStatus() async throws -> ConfigSyncStatus {
		return try JSONDecoder().decode(ConfigSyncStatus.self, from: Data(NativeRuntime.shared.vault().status().jsonString().utf8))
	}

	func enableConfigSync(
		password: String,
		mode: String? = nil,
		backend: String? = nil,
		folderPath: String? = nil
	) async throws -> ConfigSyncStatus {
		let vault = NativeRuntime.shared.vault()
		let status = try await Task.detached { try vault.enable(password: password, mode: mode, backend: backend, folderPath: folderPath) }.value
		return try JSONDecoder().decode(ConfigSyncStatus.self, from: Data(status.jsonString().utf8))
	}

	func disableConfigSync(deleteCloud: Bool = false) async throws -> ConfigSyncStatus {
		let vault = NativeRuntime.shared.vault()
		let status = try await Task.detached { try vault.disable(deleteCloud: deleteCloud) }.value
		return try JSONDecoder().decode(ConfigSyncStatus.self, from: Data(status.jsonString().utf8))
	}

	func pushConfigSync() async throws { return
	}

	func pullConfigSync() async throws { return
	}

	func listConfigSyncHistory() async throws -> [ConfigSyncHistoryItem] { return []
	}

	func restoreConfigSyncHistory(filename: String) async throws { throw TobyClientError.invalidResponse
	}

	func setDatabaseBackupsEnabled(_ enabled: Bool) async throws -> ConfigSyncStatus {
		try NativeRuntime.shared.backups().setSnapshotsEnabled(enabled)
		return try await fetchConfigSyncStatus()
	}

	func createDatabaseBackupNow() async throws {
		let service = try NativeRuntime.shared.backups()
		try await Task.detached(priority: .userInitiated) { _ = try service.createSnapshot() }.value
		return
	}

	func listDatabaseBackups() async throws -> [DatabaseSyncBackup] {
		let service = try NativeRuntime.shared.backups()
		return try JSONDecoder().decode([DatabaseSyncBackup].self, from: Data(service.snapshotsJSON().jsonString().utf8))
	}

	func restoreDatabaseBackup(deviceId: String, filename: String) async throws {
		let service = try NativeRuntime.shared.backups()
		try await Task.detached(priority: .userInitiated) { _ = try service.restoreSnapshot(deviceID: deviceId, filename: filename) }.value
		NativeRuntime.shared.relaunchToApplyRestore()
		return
	}
}

// MARK: - Config backup models

struct ConfigBackupCreateResponse {
	let backupData: Data
	let suggestedFileName: String
	/// Native mode: the finished archive on disk (moved to the chosen location).
	var fileURL: URL? = nil
}

// MARK: - Config sync models

struct ConfigSyncClock: Decodable, Equatable {
	let lamport: Int
	let utc: String
	let deviceId: String
	let deviceName: String
}

struct ConfigSyncRemoteInfo: Decodable, Equatable {
	let lamport: Int
	let utc: String
	let deviceId: String
	let deviceName: String
	let contentHash: String
}

struct ConfigSyncStatus: Decodable, Equatable {
	var enabled: Bool
	var iCloudAvailable: Bool
	var backend: String? = nil
	var folderPath: String? = nil
	var storeAvailable: Bool? = nil
	var deviceId: String
	var deviceName: String
	var vaultPath: String
	var lastPushAt: String?
	var lastPullAt: String?
	var lastError: String?
	var lastWriterDeviceName: String?
	var lastWriterDeviceId: String?
	var lastAckedLamport: Int
	var lastAckedContentHash: String
	var dirty: Bool
	var hasRemote: Bool
	var remote: ConfigSyncRemoteInfo?
	var databaseBackupsEnabled: Bool? = nil
	var lastDatabaseBackupAt: String? = nil
	var lastDatabaseBackupError: String? = nil

	var resolvedBackend: String { backend ?? "icloud" }
	var resolvedStoreAvailable: Bool { storeAvailable ?? iCloudAvailable }
}

struct DatabaseSyncBackup: Decodable, Equatable, Identifiable {
	var id: String { "\(deviceId)/\(filename)" }
	let filename: String
	let deviceId: String
	let deviceName: String
	let createdAt: String
	var path: String? = nil
	var includesProjects: Bool? = nil
	var includesRecordings: Bool? = nil
	var includesLibrary: Bool? = nil
}

struct ConfigSyncHistoryItem: Decodable, Equatable, Identifiable {
	var id: String { filename }
	let filename: String
	let createdAt: String
	let contentHash: String
	let clock: ConfigSyncClock
	var path: String? = nil
}

/// Hops listen status messages from the native service onto the main actor.
final class StatusRelay: @unchecked Sendable {
	let handler: (String) -> Void
	init(_ handler: @escaping (String) -> Void) { self.handler = handler }
	func send(_ message: String) { let handler = handler; Task { @MainActor in handler(message) } }
}

extension TobyClient {
	/// Persona and skill edits from Settings.
	func runConfigureAction(_ action: String, body: [String: String]) async throws -> ConfigureActionResponse {
		try JSONDecoder().decode(ConfigureActionResponse.self, from: Data(try NativeConfigureActions.run(action, body: body).jsonString().utf8))
	}
}
