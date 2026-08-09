import Foundation

enum AppToastStyle {
	case success
	case error
	case progress
}

enum RecordingProcessingStage: Equatable {
	case generatingAudio
	case preparingTranscription
	case transcribing
	case finalizing
	case complete
	case failed

	var label: String {
		switch self {
		case .generatingAudio: "Generating final audio…"
		case .preparingTranscription: "Preparing transcription…"
		case .transcribing: "Transcribing…"
		case .finalizing: "Finalizing…"
		case .complete: "Complete"
		case .failed: "Failed"
		}
	}
}

struct RecordingProcessingState: Identifiable, Equatable {
	let id: UUID
	var recordingId: String?
	var stage: RecordingProcessingStage
	var message: String?

	init(
		recordingId: String? = nil,
		stage: RecordingProcessingStage,
		message: String? = nil
	) {
		self.id = UUID()
		self.recordingId = recordingId
		self.stage = stage
		self.message = message ?? stage.label
	}

	var isActive: Bool {
		switch stage {
		case .generatingAudio, .preparingTranscription, .transcribing, .finalizing:
			true
		case .complete, .failed:
			false
		}
	}

	var toastTitle: String {
		switch stage {
		case .complete: "Recording transcribed"
		case .failed: "Recording issue"
		default: "Processing recording"
		}
	}

	var toastStyle: AppToastStyle {
		switch stage {
		case .failed: .error
		case .complete: .success
		default: .progress
		}
	}

	var toastAction: AppToastAction? {
		switch stage {
		case .complete:
			return recordingId.map { .openRecording(id: $0) }
		default:
			return nil
		}
	}

	func toastState() -> AppToastState {
		AppToastState(
			style: toastStyle,
			title: toastTitle,
			message: message,
			action: toastAction
		)
	}
}

enum AppToastAction: Identifiable, Equatable {
	case openRecording(id: String)
	case openURL(url: String)
	case restartApp
	case openSettings(navKey: String)

	var id: String {
		switch self {
		case .openRecording(let id):
			return "open-recording-\(id)"
		case .openURL(let url):
			return "open-url-\(url)"
		case .restartApp:
			return "restart-app"
		case .openSettings(let navKey):
			return "open-settings-\(navKey)"
		}
	}

	var label: String {
		switch self {
		case .openRecording:
			return "Open recording"
		case .openURL:
			return "View issue"
		case .restartApp:
			return "Restart"
		case .openSettings:
			return "Open settings"
		}
	}
}

struct AppToastState: Identifiable {
	let id: UUID
	let style: AppToastStyle
	let title: String
	let message: String?
	let action: AppToastAction?

	init(
		style: AppToastStyle,
		title: String,
		message: String? = nil,
		action: AppToastAction? = nil
	) {
		self.id = UUID()
		self.style = style
		self.title = title
		self.message = message
		self.action = action
	}
}

struct AppStatus: Decodable {
	let version: String
	let persona: String
	let model: String
	let hasConfiguredAIProvider: Bool?
	let tobyDir: String?
	let contextWindow: ContextWindowPayload?
	var attachmentCapability: ChatAttachmentCapability? = nil
	let personaImageUrl: String?
	let connectedIntegrations: [String]?
	let personaCount: Int?
	let skillCount: Int?
	let skills: [SkillSummary]?
	let transcription: TranscriptionStatus?
}

struct ChatAttachmentCapability: Decodable, Equatable {
	let supported: Bool
	let reason: String?
	let acceptedMediaTypes: [String]
	let maxFiles: Int
	let maxBytesPerFile: Int
	let maxTotalBytes: Int
}

struct ChatAttachmentDraft: Codable, Equatable, Identifiable {
	let id: UUID
	let filename: String
	let mediaType: String
	let dataBase64: String
	let byteSize: Int

	init(
		id: UUID = UUID(),
		filename: String,
		mediaType: String,
		dataBase64: String,
		byteSize: Int
	) {
		self.id = id
		self.filename = filename
		self.mediaType = mediaType
		self.dataBase64 = dataBase64
		self.byteSize = byteSize
	}
}

struct ChatTranscriptAttachment: Decodable, Equatable, Identifiable {
	let id: UUID
	let filename: String
	let mediaType: String
	let dataBase64: String
	let byteSize: Int

	init(
		id: UUID = UUID(),
		filename: String,
		mediaType: String,
		dataBase64: String,
		byteSize: Int
	) {
		self.id = id
		self.filename = filename
		self.mediaType = mediaType
		self.dataBase64 = dataBase64
		self.byteSize = byteSize
	}

	private enum CodingKeys: String, CodingKey {
		case id
		case filename
		case mediaType
		case dataBase64
		case byteSize
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		self.id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
		self.filename = try container.decode(String.self, forKey: .filename)
		self.mediaType = try container.decode(String.self, forKey: .mediaType)
		self.dataBase64 = try container.decode(String.self, forKey: .dataBase64)
		self.byteSize = try container.decode(Int.self, forKey: .byteSize)
	}

	var isImagePreviewable: Bool {
		mediaType.hasPrefix("image/")
	}
}

func formatAttachmentByteSize(_ bytes: Int) -> String {
	ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
}

struct TranscriptionStatus: Decodable, Equatable {
	let configured: Bool
	let settingsNavKey: String?
	/// Provider id saved in config (may be set even when `configured` is false).
	let provider: String?
	let model: String?
	let hasProviderAndModel: Bool?
	/// False when provider/model are set but no API key is resolvable.
	let hasApiKey: Bool?
	/// True when provider+model are saved but a key is still required.
	let needsApiKey: Bool?
	let statusMessage: String?
}

struct SkillSummary: Decodable, Identifiable {
	let name: String
	let description: String?
	var id: String { name }
}

struct DaemonProcessInfo: Decodable {
	let pid: Int
	let uptimeSeconds: Int
	let startedAt: String?
	let intervalSeconds: Int?
	let logPath: String?
	let webPort: Int?
	let executablePath: String?
	let execKind: String?
	let version: String?
	let tobyDir: String?
	let entryScript: String?

	init(
		pid: Int,
		uptimeSeconds: Int,
		startedAt: String? = nil,
		intervalSeconds: Int? = nil,
		logPath: String? = nil,
		webPort: Int? = nil,
		executablePath: String? = nil,
		execKind: String? = nil,
		version: String? = nil,
		tobyDir: String? = nil,
		entryScript: String? = nil
	) {
		self.pid = pid
		self.uptimeSeconds = uptimeSeconds
		self.startedAt = startedAt
		self.intervalSeconds = intervalSeconds
		self.logPath = logPath
		self.webPort = webPort
		self.executablePath = executablePath
		self.execKind = execKind
		self.version = version
		self.tobyDir = tobyDir
		self.entryScript = entryScript
	}
}

struct ChatInboundAwaitingSession: Decodable, Identifiable {
	var id: String { externalKey }
	let externalKey: String
	let displayName: String?
}

struct ChatInboundStatus: Decodable {
	let enabled: Bool
	let integration: String?
	let integrationLabel: String?
	let status: String
	let detail: String?
	let disabledReason: String?
	let updatedAt: String?
	let activeConversationName: String?
	let activeSince: String?
	let activeKind: String?
	var awaitingUserSessions: [ChatInboundAwaitingSession]? = nil

	var isConnected: Bool {
		// Config must allow listening; runtime status alone can lag a restart.
		enabled && status == "connected"
	}

	var isActive: Bool {
		isConnected && activeKind != nil && activeConversationName != nil
	}

	var hasAwaitingUserSessions: Bool {
		!(awaitingUserSessions ?? []).isEmpty
	}

	/// Human-readable connection state for status badges.
	var connectionLabel: String {
		if !enabled || status == "disabled" {
			return "Disabled"
		}
		switch status {
		case "connected":
			return "Connected"
		case "connecting":
			return "Connecting…"
		case "idle":
			return "Idle"
		case "error":
			return "Error"
		default:
			return status.isEmpty ? "Unknown" : status.capitalized
		}
	}

	/// Prefer runtime detail, then config-level disabled reason.
	var disconnectExplanation: String? {
		if isConnected { return nil }
		if let detail, !detail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			return detail
		}
		if let disabledReason, !disabledReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			return disabledReason
		}
		if !enabled {
			return "Inbound chat is not enabled in Settings → Daemon / inbound chat."
		}
		return "Inbound chat is not connected."
	}

	/// Row title: prefer the active integration label (e.g. "Slack"), else generic.
	var displayTitle: String {
		if let integrationLabel, !integrationLabel.isEmpty {
			return integrationLabel
		}
		if let integration, !integration.isEmpty {
			return integration.capitalized
		}
		return "Inbound chat"
	}
}

struct DaemonStatus: Decodable {
	let process: DaemonProcessInfo?
	let chatInbound: ChatInboundStatus?
}

struct PersonaOption: Decodable, Identifiable {
	var id: String { name }
	let name: String
	let label: String
	let imagePath: String?
	let imageUrl: String?
	let isDefault: Bool?
	let isBuiltIn: Bool?
}

struct PersonaDetail: Decodable, Identifiable {
	var id: String { name }
	let name: String
	let label: String
	let instructions: String
	let promptMode: String
	let provider: String
	let model: String
	let imagePath: String?
	let imageUrl: String?
	let isBuiltIn: Bool
	let isDefault: Bool
}

/// A chat model option from the provider catalog (`GET /api/ai/providers`).
struct AIModelOption: Decodable, Equatable, Hashable, Identifiable {
	let id: String
	let displayName: String?
	/// True when the provider catalog marks this model as a reasoning model.
	let reasoning: Bool?

	init(id: String, displayName: String? = nil, reasoning: Bool? = nil) {
		self.id = id
		self.displayName = displayName
		self.reasoning = reasoning
	}

	/// Menu / picker label; keeps the model id as the primary text.
	var pickerLabel: String {
		if reasoning == true {
			return "\(id) · reasoning"
		}
		return id
	}
}

struct AIProviderInfo: Decodable, Identifiable {
	var id: String { providerId }
	let providerId: String
	let displayName: String
	let models: [AIModelOption]
	let allowCustomModel: Bool
	var configured: Bool = false

	enum CodingKeys: String, CodingKey {
		case providerId = "id"
		case displayName
		case models
		case allowCustomModel
		case configured
	}

	/// Test / local convenience: build from bare model ids.
	init(
		providerId: String,
		displayName: String,
		models: [String],
		allowCustomModel: Bool,
		configured: Bool = false
	) {
		self.providerId = providerId
		self.displayName = displayName
		self.models = models.map { AIModelOption(id: $0) }
		self.allowCustomModel = allowCustomModel
		self.configured = configured
	}

	init(
		providerId: String,
		displayName: String,
		models: [AIModelOption],
		allowCustomModel: Bool,
		configured: Bool = false
	) {
		self.providerId = providerId
		self.displayName = displayName
		self.models = models
		self.allowCustomModel = allowCustomModel
		self.configured = configured
	}
}

struct AIProvidersResponse: Decodable {
	let providers: [AIProviderInfo]
}

struct AIProviderUsage: Decodable, Identifiable {
	let providerId: String
	let supported: Bool
	let currency: String?
	let totalSpent: Double?
	let remaining: Double?
	let totalSpentLabel: String?
	let remainingLabel: String?
	let unavailableReason: String?
	let fetchedAt: String

	var id: String { providerId }

	var displaySummary: String {
		if !supported || unavailableReason != nil {
			return "N/A"
		}
		var pieces: [String] = []
		if let totalSpentLabel, totalSpentLabel != "N/A" {
			pieces.append("\(totalSpentLabel) used")
		}
		if let remainingLabel, remainingLabel != "N/A" {
			pieces.append("\(remainingLabel) left")
		}
		return pieces.isEmpty ? "N/A" : pieces.joined(separator: " · ")
	}
}

struct AIProviderUsageResponse: Decodable {
	let usage: AIProviderUsage
}

struct AIProvidersUsageResponse: Decodable {
	let usage: [AIProviderUsage]
}

/// Generic guided setup guide for any AI provider that supports it.
struct AIProviderSetupGuide: Decodable {
	let providerId: String
	let displayName: String
	let description: String?
	let defaultModel: String?
	let steps: [AIProviderSetupGuideStep]
	let fields: [AIProviderSetupField]
	let meta: AIProviderSetupMeta?
}

struct AIProviderSetupGuideStep: Decodable, Identifiable {
	let id: String
	let title: String
	let description: String?
	let url: String?
	let urlLabel: String?
}

struct AIProviderSetupField: Decodable, Identifiable {
	var id: String { key }
	let key: String
	let label: String
	let secret: Bool?
	let placeholder: String?
	let required: Bool?
}

/// Open-ended provider extras (deep links, flags). Unknown keys are ignored.
struct AIProviderSetupMeta: Decodable {
	let signupUrl: String?
	let apiKeysUrl: String?
	let recommended: Bool?
}

struct AIProviderSetupResponse: Decodable {
	let ok: Bool
	let providerId: String
	let model: String?
	let personaName: String?
	let configured: Bool
	let remaining: Double?
	let totalSpent: Double?
	let details: AIProviderSetupDetails?
}

struct AIProviderSetupDetails: Decodable {
	let remaining: Double?
	let totalSpent: Double?
}

struct PluginsListResponse: Decodable {
	let directory: String?
	let plugins: [PluginSummary]
}

struct PluginSummary: Decodable, Identifiable {
	let name: String
	let displayName: String
	let description: String?
	let version: String?
	let protocolVersion: String?
	let icon: String?
	let iconUrl: String?
	let state: String
	let connected: Bool
	let error: String?
	let errorCode: String?

	var id: String { name }

	var statusLabel: String {
		switch state {
		case "disabled": return "Disabled"
		case "invalid": return "Invalid"
		default: return connected ? "Connected" : "Disconnected"
		}
	}
}

struct PersonaDetailResponse: Decodable {
	let persona: PersonaDetail
}

struct SessionSummary: Decodable, Identifiable {
	let id: String
	let name: String
	let createdAt: String?
	let updatedAt: String?
	var projectId: String? = nil
	var sourceIntegration: String? = nil
	var sourceDisplayName: String? = nil
	var sourceIntegrationIconUrl: String? = nil
	var externalKey: String? = nil
	var lifecycleStatus: String? = nil
	var lastRemoteMessageAt: String? = nil

	var isExternal: Bool {
		sourceIntegration != nil && externalKey != nil
	}

	var isAwaitingUser: Bool {
		lifecycleStatus == "awaiting_user"
	}

	var integrationIconUrl: URL? {
		guard let sourceIntegrationIconUrl else { return nil }
		return URL(string: ConfigReader.baseURL().absoluteString + sourceIntegrationIconUrl)
	}
}

struct SessionDetail: Decodable {
	let id: String
	let name: String
	let transcript: [TranscriptEntry]
	let messageCount: Int
	let settings: SessionSettings?
	let contextWindow: ContextWindowPayload?
	let personaImageUrl: String?
	let activePlan: PlanSummary?
	let integration: String?
	var integrationIconUrl: String? = nil
	let externalKey: String?
	var sourceDisplayName: String? = nil
	var lifecycleStatus: String? = nil
	var lastRemoteMessageAt: String? = nil

	var isExternal: Bool {
		integration != nil && externalKey != nil
	}

	var resolvedIntegrationIconUrl: URL? {
		guard let integrationIconUrl else { return nil }
		return URL(string: ConfigReader.baseURL().absoluteString + integrationIconUrl)
	}
}

struct SessionSettings: Decodable {
	let persona: String?
	let modules: [String]?
	let dryRun: Bool?
	let debug: Bool?
	let projectId: String?
}

struct ProjectSummary: Decodable, Identifiable, Equatable {
	let id: String
	let slug: String
	let name: String
	let summary: String
	let folderPath: String
	let personaName: String?
	let outputsDir: String?
	let skillsDir: String?
	let createdAt: String?
	let updatedAt: String?
}

struct ProjectsListResponse: Decodable {
	let projects: [ProjectSummary]
}

struct ProjectDetailResponse: Decodable {
	let project: ProjectSummary
	let sessions: [SessionSummary]?
}

struct ProjectMutationResponse: Decodable {
	let project: ProjectSummary
}

struct ProjectSessionResponse: Decodable {
	let session: SessionSummary
}

struct ProjectTreeResponse: Decodable {
	let tree: [ProjectTreeEntry]
}

struct ProjectTreeEntry: Decodable, Identifiable, Equatable {
	let name: String
	let relativePath: String
	let kind: String
	let children: [ProjectTreeEntry]?

	var id: String { relativePath.isEmpty ? name : relativePath }
	var isDirectory: Bool { kind == "directory" }
}

struct PlanSummary: Decodable {
	let id: String
	let goal: String
	let status: String
	let phases: [PlanPhaseSummary]
}

struct PlanPhaseSummary: Decodable {
	let id: String
	let label: String
	let status: String
}

struct CreateSessionResponse: Decodable {
	let id: String
	let name: String
	let settings: SessionSettings?
}

struct ListenSourceSelection: Decodable, Equatable {
	let mic: Bool
	let system: Bool
}

struct ListenSessionInfo: Decodable {
	let id: String
	let startedAt: String
	let sources: ListenSourceSelection
}

struct ListenStatusResponse: Decodable {
	let status: String
	let session: ListenSessionInfo?
	let outputDir: String?
	let message: String?
	let error: String?

	var isActive: Bool {
		status == "starting" || status == "recording" || status == "stopping"
			|| (status == "error" && session != nil)
	}
}

/// UI-only model representing a recording that is currently in progress.
/// Derived from `ListenStatusResponse` when `isActive` is true. Not a persisted
/// recording — it cannot be fetched from the recordings API until after stop/save.
struct ActiveRecordingInfo: Identifiable, Equatable {
	let id: String
	let startedAt: String
	let sources: ListenSourceSelection
	let outputDir: String?

	init?(_ status: ListenStatusResponse) {
		guard status.isActive, let session = status.session else { return nil }
		self.id = session.id
		self.startedAt = session.startedAt
		self.sources = session.sources
		self.outputDir = status.outputDir
	}

	init(id: String, startedAt: String, sources: ListenSourceSelection, outputDir: String? = nil) {
		self.id = id
		self.startedAt = startedAt
		self.sources = sources
		self.outputDir = outputDir
	}
}

struct ListenStopResponse: Decodable {
	let status: String
	let session: ListenSessionInfo?
	let outputDir: String?
	let message: String?
	let error: String?
	let transcript: String?
	let transcriptionError: String?

	var asStatus: ListenStatusResponse {
		ListenStatusResponse(
			status: status,
			session: session,
			outputDir: outputDir,
			message: message,
			error: error,
		)
	}
}

struct NativeAudioStopResponse: Decodable {
	let status: String
	let message: String?
	let id: String?
	let outputDir: String?
	let files: [String: String]?
	let errors: [String]?

	var asStatus: ListenStatusResponse {
		ListenStatusResponse(
			status: status,
			session: nil,
			outputDir: outputDir,
			message: message,
			error: nil,
		)
	}
}

struct ListenRecordingSummary: Decodable, Identifiable {
	let id: String
	let dir: String
	let name: String?
	let description: String?
	let createdAt: String
	let startedAt: String
	let stoppedAt: String?
	let durationMs: Int?
	let sources: ListenSourceSelection
	let hasAudio: Bool
	let hasTranscript: Bool
	let hasSummary: Bool?

	var displayName: String {
		if let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			return name
		}
		return startedAt
	}
}

struct ListenRecordingsListResponse: Decodable {
	let recordings: [ListenRecordingSummary]
}

struct ListenRecordingSummaryMeta: Decodable {
	let createdAt: String
	let personaName: String?
}

/// Timed utterance from `transcript.json` / the listen detail API.
struct ListenTranscriptSegment: Decodable, Equatable, Hashable {
	let text: String
	/// Segment start time in seconds from the beginning of the audio.
	let timestamp: Double
	let duration: Double
	let confidence: Double?
	let alternatives: [String]?
}

struct ListenRecordingMetadata: Decodable {
	let id: String
	let name: String?
	let description: String?
	let createdAt: String
	let startedAt: String
	let stoppedAt: String?
	let durationMs: Int?
	let sources: ListenSourceSelection
	let errors: [String]?
	let chatSessionId: String?
	let summary: ListenRecordingSummaryMeta?
}

struct ListenRecordingDetail: Decodable {
	let id: String
	let dir: String
	let metadata: ListenRecordingMetadata
	let hasAudio: Bool
	let audioPath: String?
	/// Preferred combined mix when present.
	let combinedPath: String?
	let micPath: String?
	let systemPath: String?
	let hasTranscript: Bool
	let transcript: String?
	let transcriptError: String?
	/// Timed segments from `transcript.json` when the model returned them.
	let segments: [ListenTranscriptSegment]?
	let warnings: [String]?
	let hasSummary: Bool?
	let summary: String?
	let summaryMeta: ListenRecordingSummaryMeta?

	var showsSummary: Bool {
		if let hasSummary { return hasSummary }
		return summary?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
	}

	/// Non-empty timed segments suitable for display (falls back to plain text otherwise).
	var timedSegments: [ListenTranscriptSegment] {
		(segments ?? []).filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
	}

	var hasTimedSegments: Bool {
		!timedSegments.isEmpty
	}

	/// Best text for copy/export: timed lines when segments exist, else plain transcript.
	var copyableTranscript: String? {
		if hasTimedSegments {
			return formatTimedTranscript(timedSegments)
		}
		guard let transcript else { return nil }
		let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed.isEmpty ? nil : trimmed
	}

	/// Distinct playable source tracks for the inspector player.
	/// Prefer single tracks first so default playback is not a summed dual mix.
	/// Dual-mono combined (L=mic, R=system) is labeled "Both (L/R)".
	var playableAudioSources: [(id: String, label: String, path: String)] {
		var items: [(id: String, label: String, path: String)] = []
		// Default listening: system (what you heard) is usually the cleanest
		// mono preview of a meeting; mic is your voice; both is dual-mono stereo.
		if let systemPath, !systemPath.isEmpty {
			items.append((id: "system", label: "System", path: systemPath))
		}
		if let micPath, !micPath.isEmpty {
			items.append((id: "mic", label: "Mic", path: micPath))
		}
		if let combinedPath, !combinedPath.isEmpty {
			let label = (micPath != nil && systemPath != nil) ? "Both (L/R)" : "Combined"
			items.append((id: "combined", label: label, path: combinedPath))
		} else if let audioPath, !audioPath.isEmpty {
			items.append((id: "combined", label: "Combined", path: audioPath))
		}
		// De-dupe if paths collide.
		var seen = Set<String>()
		return items.filter { item in
			if seen.contains(item.path) { return false }
			seen.insert(item.path)
			return true
		}
	}
}

enum TranscriptEntry: Decodable, Identifiable, Equatable {
	case user(text: String, attachments: [ChatTranscriptAttachment] = [])
	case assistant(text: String)
	case meta(text: String)
	case notice(text: String, tone: String?)
	case error(text: String)
	case boxedStep(BoxedStepPayload)
	case toolCall(blockKey: String, title: String, toolName: String?)
	case toolOutput(blockKey: String, detail: String, toolName: String?)
	case askUserQA(blockKey: String, query: String, answer: String, error: String?)
	case turnWork(durationMs: Int)

	var id: String {
		switch self {
		case .user(let text, let attachments):
			let attachmentKey = attachments.map { "\($0.filename)-\($0.byteSize)" }.joined(separator: "|")
			return "user-\(text.hashValue)-\(attachmentKey.hashValue)"
		case .assistant(let text):
			return "assistant-\(text.hashValue)"
		case .meta(let text):
			return "meta-\(text.hashValue)"
		case .notice(let text, _):
			return "notice-\(text.hashValue)"
		case .error(let text):
			return "error-\(text.hashValue)"
		case .boxedStep(let payload):
			return "boxed-\(payload.id)-\(payload.seq)"
		case .toolCall(let blockKey, _, _):
			return "tool-call-\(blockKey)"
		case .toolOutput(let blockKey, _, _):
			return "tool-output-\(blockKey)"
		case .askUserQA(let blockKey, _, _, _):
			return "ask-user-\(blockKey)"
		case .turnWork(let durationMs):
			return "turn-work-\(durationMs)"
		}
	}

	private enum CodingKeys: String, CodingKey {
		case kind
		case text
		case tone
		case id
		case seq
		case variant
		case header
		case body
		case toolBlockKey
		case toolName
		case integrationLabel
		case cacheHit
		case toolRuns
		case fullBody
		case blockKey
		case title
		case detail
		case query
		case answer
		case error
		case durationMs
		case attachments
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		let kind = try container.decode(String.self, forKey: .kind)

		switch kind {
		case "user":
			self = .user(
				text: try container.decode(String.self, forKey: .text),
				attachments: try container.decodeIfPresent([ChatTranscriptAttachment].self, forKey: .attachments) ?? [],
			)
		case "assistant":
			self = .assistant(text: try container.decode(String.self, forKey: .text))
		case "meta":
			self = .meta(text: try container.decode(String.self, forKey: .text))
		case "notice":
			self = .notice(
				text: try container.decode(String.self, forKey: .text),
				tone: try container.decodeIfPresent(String.self, forKey: .tone),
			)
		case "error":
			self = .error(text: try container.decode(String.self, forKey: .text))
		case "boxed_step":
			self = .boxedStep(
				BoxedStepPayload(
					id: try container.decode(String.self, forKey: .id),
					seq: try container.decode(Int.self, forKey: .seq),
					variant: try container.decode(String.self, forKey: .variant),
					header: try container.decode(String.self, forKey: .header),
					body: try container.decode(String.self, forKey: .body),
					toolName: try container.decodeIfPresent(String.self, forKey: .toolName),
					integrationLabel: try container.decodeIfPresent(String.self, forKey: .integrationLabel),
					cacheHit: try container.decodeIfPresent(Bool.self, forKey: .cacheHit),
					durationMs: try container.decodeIfPresent(Int.self, forKey: .durationMs),
					toolRuns: try container.decodeIfPresent([ToolRunEntry].self, forKey: .toolRuns),
					fullBody: try container.decodeIfPresent(String.self, forKey: .fullBody),
				),
			)
		case "tool_call":
			self = .toolCall(
				blockKey: try container.decode(String.self, forKey: .blockKey),
				title: try container.decode(String.self, forKey: .title),
				toolName: try container.decodeIfPresent(String.self, forKey: .toolName),
			)
		case "tool_output":
			self = .toolOutput(
				blockKey: try container.decode(String.self, forKey: .blockKey),
				detail: try container.decode(String.self, forKey: .detail),
				toolName: try container.decodeIfPresent(String.self, forKey: .toolName),
			)
		case "ask_user_qa":
			self = .askUserQA(
				blockKey: try container.decode(String.self, forKey: .blockKey),
				query: try container.decode(String.self, forKey: .query),
				answer: try container.decode(String.self, forKey: .answer),
				error: try container.decodeIfPresent(String.self, forKey: .error),
			)
		case "turn_work":
			self = .turnWork(durationMs: try container.decode(Int.self, forKey: .durationMs))
		default:
			self = .meta(text: kind)
		}
	}
}

struct ToolRunEntry: Decodable, Equatable, Identifiable {
	let blockKey: String
	let header: String
	let body: String
	let cacheHit: Bool?
	let durationMs: Int?
	let fullBody: String?

	var id: String { blockKey }
}

struct BoxedStepPayload: Equatable {
	let id: String
	let seq: Int
	let variant: String
	let header: String
	let body: String
	let toolName: String?
	let integrationLabel: String?
	let cacheHit: Bool?
	let durationMs: Int?
	let toolRuns: [ToolRunEntry]?
	let fullBody: String?
}

struct ChatEventPayload: Decodable {
	let type: String
	let delta: String?
	let header: String?
	let id: String?
	let blockKey: String?
	let detail: String?
	let line: String?
	let toolName: String?
	let integrationLabel: String?
	let cacheHit: Bool?
	let durationMs: Int?
	let text: String?
	let tone: String?
	let interim: Bool?
	let result: AnyCodable?
	let args: AnyCodable?
	let error: AnyCodable?
}

struct AnyCodable: Decodable, Equatable {
	let value: Any

	init(_ value: Any) {
		self.value = value
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		if container.decodeNil() {
			self.value = NSNull()
		} else if let bool = try? container.decode(Bool.self) {
			self.value = bool
		} else if let int = try? container.decode(Int.self) {
			self.value = int
		} else if let double = try? container.decode(Double.self) {
			self.value = double
		} else if let string = try? container.decode(String.self) {
			self.value = string
		} else if let array = try? container.decode([AnyCodable].self) {
			self.value = array.map { $0.value }
		} else if let dict = try? container.decode([String: AnyCodable].self) {
			self.value = dict.mapValues { $0.value }
		} else {
			self.value = NSNull()
		}
	}

	static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
		String(describing: lhs.value) == String(describing: rhs.value)
	}
}

struct CreateIssueResponse: Decodable {
	let ok: Bool
	let url: String?
	let number: Int?
	let fallbackUrl: String?
	let reason: String?
}

struct UsagePayload: Decodable, Equatable {
	let inputTokens: Int?
	let outputTokens: Int?
	let totalTokens: Int?
	let cacheReadTokens: Int?
	let cacheWriteTokens: Int?
}

struct ContextWindowPayload: Decodable, Equatable {
	let supported: Bool
	let contextWindowTokens: Int?
	let fillPercentage: Int?
	let unavailableReason: String?
}

struct TurnDonePayload: Decodable {
	let turnId: String?
	let text: String
	let appliedActions: [String]?
	let sessionName: String?
	let usage: UsagePayload?
	let contextWindow: ContextWindowPayload?
}

struct AskUserPromptPayload: Decodable, Equatable {
	let turnId: String
	let requestId: String
	let query: String
	let options: [String]

	init(turnId: String, requestId: String, query: String, options: [String]) {
		self.turnId = turnId
		self.requestId = requestId
		self.query = query
		self.options = options
	}
}

struct ActiveAskUserPrompt: Equatable, Identifiable {
	let id: String
	let turnId: String
	let requestId: String
	let query: String
	let options: [String]
}

struct StreamingAssistantState: Equatable {
	var header: String
	var text: String
	/// When true, stream inside the active "Worked for" group instead of the main transcript line.
	var inWorkArea: Bool
}

struct ChangelogResponse: Decodable {
	let releases: [ChangelogRelease]
}

struct ChangelogRelease: Decodable, Identifiable {
	let version: String
	let tagName: String
	let url: String
	let publishedAt: String
	let features: [ChangelogChange]
	let bugs: [ChangelogChange]
	let enhancements: [ChangelogChange]

	var id: String { tagName }
}

struct ChangelogChange: Decodable, Identifiable {
	let type: String
	let scope: String?
	let description: String
	let sha: String?

	var id: String { "\(type):\(scope ?? ""):\(description)" }
}

struct ScheduleRunDetail: Decodable, Identifiable {
	let id: String
	let scheduleId: String
	let scheduleName: String?
	let personaName: String
	let prompt: String
	let output: String?
	let status: String
	let error: String?
	let startedAt: String
	let completedAt: String?
	let transcript: [ScheduleRunTranscriptEvent]

	var isRunning: Bool { status == "running" }
	var displayStatus: String { status.uppercased() }
	var titleScheduleName: String { scheduleName ?? "Schedule" }
}

struct ScheduleRunTranscriptEvent: Decodable, Identifiable {
	let type: String
	let seq: Int
	let header: String?
	let detail: String?
	let delta: String?
	let line: String?
	let text: String?
	let toolName: String?
	let integrationLabel: String?
	let durationMs: Int?
	let cacheHit: Bool?
	let interim: Bool?
	let error: String?

	var id: String { "\(seq)" }
}
