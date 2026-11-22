import SwiftUI

/// Node kinds in Toby's context graph (`packages/core/src/graph/types.ts`).
enum GraphNodeKind: String, CaseIterable, Identifiable, Sendable {
	case person, org, project, topic, thread, observation, memory, todo, event, loop

	var id: String { rawValue }

	/// Kinds requested by default; observations are folded into shared-activity links.
	static let defaultVisible: Set<GraphNodeKind> = Set(allCases.filter { $0 != .observation })

	var title: String {
		switch self {
		case .person: "People"
		case .org: "Organizations"
		case .project: "Projects"
		case .topic: "Topics"
		case .thread: "Threads"
		case .observation: "Activity"
		case .memory: "Memories"
		case .todo: "Todos"
		case .event: "Events"
		case .loop: "Follow-ups"
		}
	}

	var singularTitle: String {
		switch self {
		case .person: "Person"
		case .org: "Organization"
		case .project: "Project"
		case .topic: "Topic"
		case .thread: "Thread"
		case .observation: "Activity"
		case .memory: "Memory"
		case .todo: "Todo"
		case .event: "Event"
		case .loop: "Follow-up"
		}
	}

	var systemImage: String {
		switch self {
		case .person: "person.fill"
		case .org: "building.2.fill"
		case .project: "folder.fill"
		case .topic: "tag.fill"
		case .thread: "bubble.left.and.bubble.right.fill"
		case .observation: "envelope.fill"
		case .memory: "brain.head.profile"
		case .todo: "checklist"
		case .event: "calendar"
		case .loop: "arrow.uturn.backward.circle.fill"
		}
	}

	/// Categorical system colors adapt to light and dark appearance.
	var color: Color {
		switch self {
		case .person: .blue
		case .org: .indigo
		case .project: .green
		case .topic: .orange
		case .thread: .teal
		case .observation: .gray
		case .memory: .purple
		case .todo: .mint
		case .event: .red
		case .loop: .yellow
		}
	}
}

struct GraphSnapshotNode: Decodable, Identifiable, Equatable, Sendable {
	let id: String
	let type: String
	let label: String
	let detail: String?
	let degree: Int
	let updatedAt: String

	var kind: GraphNodeKind? { GraphNodeKind(rawValue: type) }
}

struct GraphSnapshotEdge: Decodable, Identifiable, Equatable, Sendable {
	let id: String
	let src: String
	let dst: String
	let type: String
	let weight: Double
	let confidence: Double
	let origin: String
	let occurrences: Int
	let reason: String?

	/// Human wording for the relationship, read from `src`'s side.
	var relationTitle: String {
		switch type {
		case "sent": "sent"
		case "received": "received"
		case "in_thread": "in thread"
		case "attends": "attends"
		case "mentions": "mentions"
		case "about": "about"
		case "alias_of": "same as"
		case "works_at": "works at"
		case "related_to": "related to"
		case "evidence_for": "evidence for"
		case "tracks": "tracks"
		case "shared_activity": occurrences == 1 ? "1 shared item" : "\(occurrences) shared items"
		default: type.replacingOccurrences(of: "_", with: " ")
		}
	}
}

struct GraphSnapshotTotals: Decodable, Equatable, Sendable {
	let nodes: Int
	let edges: Int
}

struct GraphSnapshotResponse: Decodable, Equatable, Sendable {
	let nodes: [GraphSnapshotNode]
	let edges: [GraphSnapshotEdge]
	let totals: GraphSnapshotTotals
	let truncated: Bool

	static let empty = GraphSnapshotResponse(
		nodes: [],
		edges: [],
		totals: GraphSnapshotTotals(nodes: 0, edges: 0),
		truncated: false
	)
}

/// One row in the inspector's connection list.
struct GraphConnection: Identifiable, Equatable {
	let edge: GraphSnapshotEdge
	let node: GraphSnapshotNode

	var id: String { edge.id }
}
