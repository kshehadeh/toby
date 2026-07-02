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
	let contextWindow: ContextWindowPayload?
	let personaImageUrl: String?
	let connectedIntegrations: [String]?
	let skillCount: Int?
	let skills: [SkillSummary]?
	let transcription: TranscriptionStatus?
}

struct TranscriptionStatus: Decodable, Equatable {
	let configured: Bool
	let settingsNavKey: String?
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

	var isConnected: Bool {
		status == "connected"
	}

	var isActive: Bool {
		activeKind != nil && activeConversationName != nil
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

struct AIProviderInfo: Decodable, Identifiable {
	var id: String { providerId }
	let providerId: String
	let displayName: String
	let models: [String]
	let allowCustomModel: Bool

	enum CodingKeys: String, CodingKey {
		case providerId = "id"
		case displayName
		case models
		case allowCustomModel
	}
}

struct AIProvidersResponse: Decodable {
	let providers: [AIProviderInfo]
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
	let externalKey: String?

	var isExternal: Bool {
		integration != nil && externalKey != nil
	}
}

struct SessionSettings: Decodable {
	let persona: String?
	let modules: [String]?
	let dryRun: Bool?
	let debug: Bool?
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

struct ListenSourceSelection: Decodable {
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
}

struct ListenRecordingDetail: Decodable {
	let id: String
	let dir: String
	let metadata: ListenRecordingMetadata
	let hasAudio: Bool
	let audioPath: String?
	let hasTranscript: Bool
	let transcript: String?
	let transcriptError: String?
	let warnings: [String]?
}

enum TranscriptEntry: Decodable, Identifiable, Equatable {
	case user(text: String)
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
		case .user(let text):
			return "user-\(text.hashValue)"
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
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		let kind = try container.decode(String.self, forKey: .kind)

		switch kind {
		case "user":
			self = .user(text: try container.decode(String.self, forKey: .text))
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

struct AskUserPromptPayload: Decodable {
	let turnId: String
	let requestId: String
	let query: String
	let options: [String]
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
