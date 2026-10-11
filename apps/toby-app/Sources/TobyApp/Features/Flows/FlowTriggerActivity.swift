import SwiftUI

struct FlowTriggerDecision: Decodable, Identifiable {
    struct Binding: Decodable { let trigger: FlowTriggerSpec }
    struct Event: Decodable { let type: String; let occurredAt: String }
    let id: String
    let binding: Binding
    let event: Event
    let status: String
    let reason: String?
    let flowRunId: String?
    let output: String?
}

@Observable @MainActor
final class FlowTriggerActivityStore {
    var decisions: [FlowTriggerDecision] = []
    var source: FlowTriggerSourceState?
    var error: String?
    var loading = false
    private var requestID = UUID()
    func load(flowId: String) async {
        let request = UUID()
        requestID = request
        loading = true
        decisions = []
        error = nil
        defer { if requestID == request { loading = false } }
        do {
            struct Response: Decodable { let decisions: [FlowTriggerDecision] }
            let client = TobyClient()
            let response: Response = try await client.flowTriggerRequest("/activity?flowId=\(flowId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? flowId)")
            let status: FlowTriggerSourceState = try await client.flowTriggerRequest("/status")
            guard !Task.isCancelled, requestID == request else { return }
            decisions = response.decisions
            source = status
            error = nil
        } catch { if !Task.isCancelled, requestID == request { self.error = error.localizedDescription } }
    }
}

struct FlowTriggerActivity: View {
    let flowId: String
    let onOpenRun: (String) -> Void
    @State private var store = FlowTriggerActivityStore()
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Trigger activity").font(.headline)
                    Spacer()
                    Button("Refresh", systemImage: "arrow.clockwise") { Task { await store.load(flowId: flowId) } }.disabled(store.loading)
                }
                if let source = store.source { Text(source.message).font(.caption).foregroundStyle(.secondary) }
                if let error = store.error { InlineStatusMessage(message: error, tone: .error, font: .caption) }
                if store.loading && store.decisions.isEmpty { ProgressView("Loading activity…") }
                else if store.decisions.isEmpty { Text("No trigger activity yet.").foregroundStyle(.secondary) }
                ForEach(store.decisions) { decision in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack { Text(decision.binding.trigger.name).fontWeight(.medium); Spacer(); Text(decision.status.capitalized) }
                        Text(decision.event.occurredAt).font(.caption).foregroundStyle(.secondary)
                        if let reason = decision.reason { Text(reason.replacingOccurrences(of: "_", with: " ")).font(.caption) }
                        if let runId = decision.flowRunId { Button("View result and steps") { onOpenRun(runId) } }
                    }
                    Divider()
                }
            }.padding(20)
        }.task(id: flowId) { await store.load(flowId: flowId) }
    }
}

struct FlowTriggerSourceState: Decodable { let state: String; let message: String; let lastPollAt: String? }
