import Foundation

enum SettingsItemKind: String, Decodable {
	case section
	case value
	case action
	case select
	case multiSelect
	case delete
	case hint
}

struct SettingsSelectChoice: Decodable, Equatable {
	let value: String
	let label: String
}

struct SettingsItem: Decodable, Identifiable {
	var id: String { navKey ?? key }
	let label: String
	let kind: SettingsItemKind
	let key: String
	let navKey: String?
	let children: [SettingsItem]?
	let masked: Bool?
	let multiline: Bool?
	let options: [String]?
	let selectChoices: [SettingsSelectChoice]?
	let currentValue: String?
	let selectedValues: [String]?
	let readOnly: Bool?
}

struct ConfigureTreeResponse: Decodable {
	let tree: SettingsItem
	let values: [String: String]
	let integrationLabels: [String: String]?
}

struct ConfigureActionResponse: Decodable {
	let ok: Bool
	let personaName: String?
	let scheduleId: String?
	let runId: String?
}

enum IntegrationAction: String, Sendable {
	case connect
	case disconnect
	case reauthorize
	case setup
}

struct IntegrationStatus: Decodable {
	let name: String
	let displayName: String
	let description: String?
	let connected: Bool
	let pluginPath: String?
	let supportsSetup: Bool
	let setupDescription: String?
	let health: IntegrationHealth?
}

struct IntegrationHealth: Decodable {
	let ok: Bool
	let details: String?
	let tools: [IntegrationToolHealth]?
}

struct IntegrationToolHealth: Decodable {
	let tool: String
	let ok: Bool
	let details: String?
}

struct IntegrationActionResponse: Decodable {
	let ok: Bool
	let error: String?
}

enum ConfigureConstants {
	static let redactedSecret = "••••••"
}

struct SidebarTreeNode: Identifiable {
	var id: String { navKey }
	let item: SettingsItem
	let navKey: String
	let depth: Int
	let children: [SidebarTreeNode]
}

enum ConfigureTreeHelpers {
	private static let sidebarExcludedKeys: Set<String> = [
		"listen",
		"listen._start",
		"personas._new",
		"schedules",
		"schedules._new",
	]

	private static func isSidebarSection(_ item: SettingsItem) -> Bool {
		guard item.kind == .section else { return false }
		if sidebarExcludedKeys.contains(item.key) { return false }
		if item.key.hasSuffix("._hint") || item.key.hasSuffix("._empty") { return false }
		return true
	}

	private static func buildSidebarNode(
		_ node: SettingsItem,
		depth: Int,
	) -> SidebarTreeNode? {
		guard isSidebarSection(node) else { return nil }
		let navKey = node.navKey ?? node.key
		let children = (node.children ?? []).compactMap { child -> SidebarTreeNode? in
			guard child.kind == .section else { return nil }
			return buildSidebarNode(child, depth: depth + 1)
		}
		return SidebarTreeNode(item: node, navKey: navKey, depth: depth, children: children)
	}

	static func buildSidebarTree(root: SettingsItem) -> [SidebarTreeNode] {
		(root.children ?? []).compactMap { buildSidebarNode($0, depth: 0) }
	}

	static func findSectionByNavKey(_ root: SettingsItem, navKey: String) -> SettingsItem? {
		func walk(_ node: SettingsItem) -> SettingsItem? {
			if node.key == "root" {
				for child in node.children ?? [] {
					if let found = walk(child) { return found }
				}
				return nil
			}
			let key = node.navKey ?? node.key
			if key == navKey { return node }
			for child in node.children ?? [] where child.kind == .section {
				if let found = walk(child) { return found }
			}
			return nil
		}
		return walk(root)
	}

	static func findSidebarAncestorKeys(
		_ nodes: [SidebarTreeNode],
		targetKey: String,
		ancestors: [String] = [],
	) -> [String]? {
		for node in nodes {
			if node.navKey == targetKey { return ancestors }
			if !node.children.isEmpty {
				if let found = findSidebarAncestorKeys(
					node.children,
					targetKey: targetKey,
					ancestors: ancestors + [node.navKey],
				) {
					return found
				}
			}
		}
		return nil
	}

	static func findSidebarNode(
		_ nodes: [SidebarTreeNode],
		targetKey: String,
	) -> SidebarTreeNode? {
		for node in nodes {
			if node.navKey == targetKey { return node }
			if let found = findSidebarNode(node.children, targetKey: targetKey) {
				return found
			}
		}
		return nil
	}

	static func isContainerSection(_ section: SettingsItem) -> Bool {
		let children = section.children ?? []
		let substantive = children.filter { $0.kind != .hint && $0.kind != .action }
		if substantive.isEmpty { return false }
		return substantive.allSatisfy { $0.kind == .section && !($0.children?.isEmpty ?? true) }
	}

	static func isEditableField(_ field: SettingsItem) -> Bool {
		if field.readOnly == true { return false }
		switch field.kind {
		case .hint, .action, .delete:
			return false
		case .value, .select, .multiSelect:
			return true
		default:
			return false
		}
	}

	static func actionForKey(_ key: String) -> (name: String, body: [String: String])? {
		if key == "personas._new" {
			return ("create-persona", [:])
		}
		if key == "schedules._new" {
			return ("create-schedule", [:])
		}
		if let personaName = captureGroup(in: key, pattern: #"^personas\.(.+)\._setDefault$"#) {
			return ("set-default-persona", ["personaName": personaName])
		}
		if let personaName = captureGroup(in: key, pattern: #"^personas\.(.+)\._delete$"#) {
			return ("delete-persona", ["personaName": personaName])
		}
		if let dirName = captureGroup(in: key, pattern: #"^skills\.(.+)\._delete$"#) {
			return ("delete-skill", ["dirName": dirName])
		}
		if let scheduleId = captureGroup(in: key, pattern: #"^schedules\.(.+)\._delete$"#) {
			return ("delete-schedule", ["scheduleId": scheduleId])
		}
		return nil
	}

	private static func captureGroup(in text: String, pattern: String) -> String? {
		guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
		let range = NSRange(text.startIndex..<text.endIndex, in: text)
		guard let match = regex.firstMatch(in: text, range: range),
			match.numberOfRanges > 1,
			let captureRange = Range(match.range(at: 1), in: text)
		else {
			return nil
		}
		return String(text[captureRange])
	}

	static func isBooleanSelectField(_ field: SettingsItem) -> Bool {
		guard field.kind == .select, let options = field.options else { return false }
		let normalized = Set(options.map { $0.lowercased() })
		return normalized == ["yes", "no"] || normalized == ["true", "false"]
	}
}
