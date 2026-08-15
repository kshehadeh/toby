import AppKit
import Foundation
import Observation

/// Runtime controller for one home-dashboard data block.
///
/// The **descriptor** is the card definition (static header: title + actions).
/// **content** is flow output for the body — refreshed by a single update path.
@Observable
@MainActor
final class CategoryDashboardBlock {
	/// Stable identity (matches daemon category path). Immutable after init.
	nonisolated let id: DashboardBlockID
	private(set) var descriptor: DashboardBlockDescriptor
	private let client: TobyClient

	/// Latest flow output for the body (nil = no providers / not loaded).
	var content: DashboardBlockContent?
	var isLoading = false
	/// True while a force refresh is in flight (shows skeleton over stale body).
	var isForceUpdating = false
	var error: String?

	/// In-flight `update(force:)` for coalescing concurrent callers.
	@ObservationIgnored
	private var inFlight: Task<Void, Never>?
	@ObservationIgnored
	private var inFlightForce = false

	var title: String { descriptor.title }
	var systemImage: String { descriptor.systemImage }
	var sortIndex: Int { descriptor.sortIndex }
	var accessibilityIdentifier: String { descriptor.accessibilityIdentifier }

	/// Content load in progress.
	var isUpdating: Bool { isLoading || isForceUpdating }

	var snapshot: DashboardBlockSnapshot {
		DashboardBlockSnapshot(
			id: id,
			content: content,
			error: error
		)
	}

	init(descriptor: DashboardBlockDescriptor, client: TobyClient = TobyClient()) {
		self.id = descriptor.id
		self.descriptor = descriptor
		self.client = client
	}

	func applyFlowDescriptor(_ next: DashboardBlockDescriptor) {
		descriptor = next
	}

	// MARK: - Update

	/// Single refresh path: fetch block content (flow output) only.
	/// - Parameter force: Bypass server caches and await a fresh flow run.
	func update(force: Bool) async {
		if let existing = inFlight {
			await existing.value
			if !force || inFlightForce {
				return
			}
			// Soft finished while we needed force — fall through.
		}

		let task = Task { @MainActor in
			await self.performUpdate(force: force)
		}
		inFlight = task
		inFlightForce = force
		await task.value
		if inFlight == task {
			inFlight = nil
			inFlightForce = false
		}
	}

	private func performUpdate(force: Bool) async {
		// Runner cards never auto-run and do not show last-run output.
		if descriptor.isFlowRunner {
			return
		}

		if force {
			isForceUpdating = true
			// Clear body so the skeleton shows during force regen.
			content = nil
		}
		isLoading = true
		error = nil
		defer {
			isLoading = false
			if force {
				isForceUpdating = false
			}
		}

		do {
			if let latest = try await client.fetchDashboardBlockContent(
				descriptor.rawId,
				fresh: force
			) {
				content = latest
			} else if force {
				content = nil
			}
			// Soft null: keep previous content so a transient miss does not blank the card.
		} catch {
			self.error = error.localizedDescription
		}
	}

	// MARK: - Actions (definition-driven; enablement from content meta)

	func actions(context: DashboardBlockActionContext) -> [DashboardBlockAction] {
		var result: [DashboardBlockAction] = []
		let snap = snapshot
		let count = snap.content?.count ?? 0

		if let openTitle = descriptor.openPrimaryTitle {
			result.append(
				DashboardBlockAction(
					id: "open-primary",
					title: openTitle,
					isEnabled: true,
					perform: { [weak self] in self?.openPrimary() }
				)
			)
		}

		if descriptor.listsSourceOpenActions {
			if let sources = snap.content?.sources {
				for source in sources {
					guard let launch = source.launchUrl, let url = URL(string: launch) else {
						continue
					}
					let name = source.providerDisplayName
					result.append(
						DashboardBlockAction(
							id: "open-source-\(source.providerName)",
							title: "Open \(name)",
							isEnabled: true,
							perform: { NSWorkspace.shared.open(url) }
						)
					)
				}
			} else if let urls = snap.content?.launchUrls {
				for (index, launch) in urls.enumerated() {
					guard let url = URL(string: launch) else { continue }
					result.append(
						DashboardBlockAction(
							id: "open-launch-\(index)",
							title: "Open provider",
							isEnabled: true,
							perform: { NSWorkspace.shared.open(url) }
						)
					)
				}
			}
		}

		switch id {
		case .email:
			result.append(
				DashboardBlockAction(
					id: "summarize-email",
					title: "Summarize all in chat",
					isEnabled: count > 0,
					perform: { Task { @MainActor in context.summarizeEmail() } }
				)
			)
		case .tasks:
			result.insert(
				DashboardBlockAction(
					id: "add-task",
					title: "Add a task",
					isEnabled: true,
					perform: { Task { @MainActor in context.startChat() } }
				),
				at: 0
			)
		case .calendar:
			result.append(
				DashboardBlockAction(
					id: "plan-in-chat",
					title: "Plan in chat",
					isEnabled: true,
					perform: { Task { @MainActor in context.planInChat() } }
				)
			)
		default:
			if descriptor.isFlowBlock {
				result.append(
					DashboardBlockAction(
						id: "open-flow",
						title: "Open flow",
						isEnabled: true,
						perform: { Task { @MainActor in context.openFlow(self.id.rawValue) } }
					)
				)
			}
		}

		return result
	}

	/// Open the primary provider app (content launchUrl or definition fallback).
	func openPrimary() {
		if let launch = content?.launchUrls?.first ?? content?.sources?.compactMap(\.launchUrl).first,
			let url = URL(string: launch)
		{
			NSWorkspace.shared.open(url)
			return
		}
		let workspace = NSWorkspace.shared
		if let bundleId = descriptor.openFallbackBundleId {
			if let appURL = workspace.urlForApplication(withBundleIdentifier: bundleId) {
				workspace.openApplication(at: appURL, configuration: NSWorkspace.OpenConfiguration())
				return
			}
			if bundleId == "com.apple.iCal", let url = URL(string: "ical://") {
				workspace.open(url)
				return
			}
		}
		if id == .email, let mailto = URL(string: "mailto:") {
			if let appURL = workspace.urlForApplication(toOpen: mailto) {
				workspace.openApplication(at: appURL, configuration: NSWorkspace.OpenConfiguration())
			} else {
				workspace.open(mailto)
			}
		}
	}
}
