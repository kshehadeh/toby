import SwiftUI

struct CommandPaletteResult: Identifiable {
	enum Kind: Equatable {
		case action
		case route(DetailRoute)
		case session(String)
		case integration(String)
		case schedule(String)
		case recording(String)
	}

	let id: String
	let title: String
	let subtitle: String
	let systemImage: String
	let kind: Kind
}
