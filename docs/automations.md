# Native Flow triggers

Automations are now trigger definitions embedded in [Flows](flows.md#triggers).
There is no separate Automation store, authoring tool, window, or HTTP API.

The daemon observes native events via `/api/native/flows/triggers/subscriptions`
and `/api/native/flows/triggers/events`. Toby.app owns wake/idle/FSEvents observation;
the core Flow supervisor owns matching, deduplication, conditions, queueing, and
execution. Native observation uses expiring leases and session/sequence cursors.
Transport gaps are logged; missed native events are not replayed.

Sources: `macos.didWake`, `macos.userReturned` (`minimumIdleSeconds`), and
`macos.fileChanges` (absolute folder, recursive, extensions, excludedPaths,
kinds new/changed/deleted, settlingSeconds, allowLargeFolder). A file watch ID
includes the Flow revision; stale watch events cannot target an edited definition.
Exclude generated output folders to prevent repeated runs. Deleted files may
have no contents. Large folders require explicit acknowledgement.

Use `inspectFlowFolder` while authoring. Use `inspectFlow` / `updateFlow` with
revision checks to change triggers. Native observation requires Toby.app to stay
running. Idle does not prove absence, and wake does not imply screen unlock.

Activity and source status are exposed by `/api/flows/triggers/activity?flowId=…`
and `/api/flows/triggers/status`. Run traces use the standard Flow run endpoints.
