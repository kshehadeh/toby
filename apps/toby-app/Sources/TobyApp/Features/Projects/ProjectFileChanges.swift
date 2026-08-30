import Foundation

enum ProjectTreeChangeKind: String, Equatable, Sendable {
	case added
	case updated
	case deleted

	var label: String {
		rawValue.capitalized
	}
}

struct ProjectTreeChange: Equatable, Identifiable, Sendable {
	let entry: ProjectTreeEntry
	let kind: ProjectTreeChangeKind

	var id: String { "\(kind.rawValue):\(entry.id)" }
}

func projectTreeChanges(
	from previous: [ProjectTreeEntry],
	to next: [ProjectTreeEntry],
) -> [ProjectTreeChange] {
	let previousByPath = Dictionary(
		uniqueKeysWithValues: flattenedProjectTree(previous).map { ($0.relativePath, $0) }
	)
	let nextByPath = Dictionary(
		uniqueKeysWithValues: flattenedProjectTree(next).map { ($0.relativePath, $0) }
	)

	var changes: [ProjectTreeChange] = []
	for (path, entry) in nextByPath {
		guard let prior = previousByPath[path] else {
			changes.append(ProjectTreeChange(entry: entry, kind: .added))
			continue
		}
		if prior.kind != entry.kind
			|| prior.modifiedAtMs != entry.modifiedAtMs
			|| prior.size != entry.size
		{
			changes.append(ProjectTreeChange(entry: entry, kind: .updated))
		}
	}
	for (path, entry) in previousByPath where nextByPath[path] == nil {
		changes.append(ProjectTreeChange(entry: entry, kind: .deleted))
	}
	return changes.sorted { lhs, rhs in
		lhs.entry.relativePath.localizedStandardCompare(rhs.entry.relativePath) == .orderedAscending
	}
}

func flattenedProjectTree(_ entries: [ProjectTreeEntry]) -> [ProjectTreeEntry] {
	entries.flatMap { entry in
		[entry] + flattenedProjectTree(entry.children ?? [])
	}
}
