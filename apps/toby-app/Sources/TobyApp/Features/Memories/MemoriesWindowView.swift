import SwiftUI

struct MemoriesWindowView: View {
	@Bindable var store: MemoriesStore

	var body: some View {
		NavigationStack {
			MemoriesView(store: store)
		}
		.frame(minWidth: 640, minHeight: 480)
	}
}
