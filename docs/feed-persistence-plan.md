# Feed persistence and duplicate prevention

**Status** — Implemented in the native app. Feed decisions, source membership and ranked results use SQLite. The card carries a stable row ID and an immutable target for actions. The migration retains unresolved historical decisions under their original IDs. For a repeating Apple Reminder that reuses its native ID, Toby preserves a dismissal through date edits and advances the occurrence when it has evidence of completion.

A user who removes a card should be able to refresh Home, restart Toby, or restore a backup and trust that decision. A later card about the same work should have an identifiable reason to appear. The two examples from the investigation give us concrete acceptance cases. Turning a calendar event into a todo immediately produced a second card with the same title. Archiving a message was followed by another message with the same sender and subject. The available data established two distinct messages. It did not establish whether they belonged to one conversation.

## 1. Define what can bring a card back

| User action | Proposed behavior | What can appear later |
| --- | --- | --- |
| Dismiss | Persist the decision for the occurrence, task, Slack message, or mail conversation activity shown. | A different calendar occurrence, a new task occurrence, or a genuinely newer incoming message can qualify. Renaming, rereading, reranking, or aging past 30 days cannot reopen the handled work. |
| Not relevant | Apply the same dismissal and preserve the existing feedback signal for ranking similar items. | Other items remain individually eligible under the existing Feed rules. |
| Snooze | Hide the card through the existing next-morning deadline, including activity on the card during the snooze. | At expiry, evaluate the latest source state and the normal relevance rules. |
| Archive or mark read | Act on the exact mail message the user saw. Record the conversation activity covered by that card. Older messages in the conversation cannot take its place. | A newer incoming reply may produce one card identifying the new sender and message. |
| Add to todos | Create one todo, link it to the source card, and mark that work handled in the Feed. The todo is available immediately in Todos. | In the first version, the resulting todo stays off the Feed for that occurrence, even as its due date approaches. Explicit todo reminders still follow their own settings. |
| Complete | Complete the displayed source occurrence and retain its handled identity. | The next occurrence of a repeating task can qualify independently. |

Two deliberate product choices are worth reviewing before implementation. Ordinary dismissal of a mail card allows a later reply. A permanent conversation mute would be a separate feature. Converting an item to a todo hands responsibility to Todos. Reintroducing that todo on a later deadline would require an explicit rule and a reason the user can see.

## 2. Give each card a durable identity

Add a GRDB migration in TobyStore and a persistence component used by TobyCore’s FeedService. Pass the active database writer from NativeRuntime, alongside the existing services. The following are proposed records and constraints.

| Record | What to persist | Constraint or retention |
| --- | --- | --- |
| Feed item | Stable card ID, kind, grouping key, current activity revision, and timestamps. | Unique grouping key within the source account or workspace. Repeated ingestion finds the existing card. |
| Source membership | Card ID, scoped source identity, occurrence or message identity, activity order, and current locator for opening or acting on it. | Unique scoped source identity. Several messages or an explicitly linked todo can belong to the same card. |
| User decision | Card ID, action, exact target, activity covered, time, and snooze deadline when applicable. | A handled identity survives cache eviction. Retain enough compact identity and decision data to enforce it after payloads expire. |
| Outstanding action | Stable request key, target, expected activity revision and operation status. | At most one execution per request. Retain unresolved remote outcomes through restart. |
| Ranked result | Ordered card IDs, the activity revision shown, rank metadata and collection generation. | Rebuildable. Visibility and notification eligibility are checked against current decisions on every read. |

Keep the card ID separate from the locator used to perform an action. For example, the email reader still needs a concrete mailbox and UID. Pass the target and displayed revision through the card, reader, client and native router so clicking Archive in an older window cannot archive a newly arrived reply. Use additive fields in the existing Feed response shape and accept unambiguous legacy IDs during migration. [Current Feed models](../apps/toby-app/Sources/TobyApp/Models/FeedModels.swift) · [Email reader](../apps/toby-app/Sources/TobyApp/Features/Mail/EmailReaderStore.swift)

### Identity rules by source

- **Mail.** Scope identity to the connected account. Read Message-ID, References, and In-Reply-To in the Feed collection path. Reuse Toby’s existing thread-ID helper and retain message-to-thread links so a later parent can connect previously separate records. When merging, carry forward the decisions for the activity each covered. Use mailbox, UIDVALIDITY and UID as the fallback when a stable message ID is unavailable. Validate the mailbox generation before issuing a remote mutation. Equal senders and subjects alone never establish a thread. [Mail collection and thread helper](../apps/toby-app/Sources/TobyCore/Mail/MailService.swift)
- **Mail activity order.** Capture the latest incoming message represented by the displayed card and a mailbox delivery boundary, using the mailbox generation and UID where available. A delayed scan of older mail must not advance that boundary. Treat flag edits, archive-folder rediscovery and duplicate copies of a known Message-ID as updates to known activity. A distinct inbox delivery newer than the handled boundary can reopen a confirmed thread. On UIDVALIDITY changes, reconcile stable message IDs first and conservatively handle ambiguous historical mail. Test this separately from normal delivery.
- **Calendar and tasks.** Use provider and calendar or list account scope, native record identity and a stable occurrence identity for recurring work. Verify which EventKit fields survive an edit or reschedule using recurring-event fixtures. For Toby todos, use the existing todo ID and recurrence sequence where applicable. Preserve an occurrence’s dismissal through a title or schedule edit. [Apple source mapping](../apps/toby-app/Sources/TobyCore/Native/AppleTools.swift) · [Todo transitions](../apps/toby-app/Sources/TobyCore/Todos/TodoService.swift)
- **Slack.** Scope the existing channel ID and message timestamp to the workspace. A message found by both mention and DM searches maps to one item. Keep separate Slack messages independently actionable in this version. [Slack summary](../apps/toby-app/Sources/TobyCore/Slack/SlackService.swift)
- **Cross-source links.** Create the link when Toby performs an action that proves the relationship, such as creating a todo from a particular calendar occurrence. Two independently created records with the same title remain independent. Legacy records without a trustworthy link keep their individual IDs.

## 3. Make actions and refreshes agree

1. **Collect and reconcile.** Upsert source records, resolve membership, apply decisions and Feed rules, and send at most one eligible candidate per card to the ranker. Track source success separately from absence in a limited result set. A disconnected source or an empty page must never erase a user decision.
2. **Rank outside the write transaction.** Capture candidate revisions and a generation before awaiting OpenRouter. On return, reject a superseded ranking and exclude candidates whose activity or visibility changed. Use the same visibility query for warm-cache responses, the last successful ranking after an error, and notifications. Persist notification deduplication by card and activity revision.
3. **Commit local actions atomically.** For Add to todos, expose the existing todo mutation logic inside a shared GRDB write transaction. Use one request key and commit todo creation, sync operation, source link, and Feed decision together. Return the original todo ID on retry and notify observers after commit. Use the same approach for native Toby todo completion. [Todo mutation transaction](../apps/toby-app/Sources/TobyCore/Todos/TodoService.swift)
4. **Reconcile external actions.** Persist intent before making an IMAP or EventKit call. On confirmed success, commit the decision for the displayed activity. On definitive failure, restore eligibility and show the error. When the outcome is unknown after a timeout or crash, inspect the original target before retrying. An unavailable mailbox leaves the action pending. A newer reply or reused UID must never become the retry target.
5. **Order UI responses.** Carry a monotonic Feed generation on refresh and action responses. Have FeedStore ignore older responses and retain optimistic hides until an authoritative response covers that action. When an old card’s target cannot be verified, offer a refresh and leave the newer target alone. [FeedStore](../apps/toby-app/Sources/TobyApp/Features/Dashboard/Feed/FeedStore.swift) · [Feed service](../apps/toby-app/Sources/TobyCore/Feed/FeedService.swift)

## 4. Upgrade existing Toby homes

- Create the schema first. Before the scheduler or Home can collect, run a one-time import for the active database and home. Read the raw state file directly so the old 30-day pruning logic cannot discard a decision that is still on disk.
- Import dismissals, done actions, active snoozes, feedback, instructions and compiled rules, and notification history. Use ranked and recent items to recover exact source aliases where available. Keep unresolved historical decisions keyed to their original source IDs. Scope legacy mail aliases only when the account can be identified safely. Already-pruned decisions and missing historical event-to-todo links cannot be reconstructed reliably.
- Commit imported data and the completion marker in one transaction. Keep the original files intact. A missing ranked cache is recoverable by reranking. A present but unreadable decision file must surface an import error and remain available for retry. After cutover, SQLite owns Feed writes. Document that opening an older build reads the pre-upgrade JSON snapshot.
- Exercise a native backup and restore in a fresh scratch home. The existing backup service snapshots SQLite, so the tables and import marker should travel together. Also test restoring an older backup with no Feed tables or state file, and restoring over a home containing residual legacy JSON. Import only state belonging to the restored home. [Schema migration](../apps/toby-app/Sources/TobyStore/Schema.swift) · [Backup and restore](../apps/toby-app/Sources/TobyCore/Backup/BackupService.swift)

## 5. Deliver in reviewable increments

| Increment | Deliverable | Exit condition |
| --- | --- | --- |
| 1. Persistence and import | Add schema, importer, scoped source identities and a persisted decision query. Wire the startup path and keep current ranking behavior. | A fixture with dismissed, done and snoozed items produces the expected Feed after two launches, including a dismissal older than 30 days. |
| 2. Actions and refresh ordering | Wire durable request keys, checked action targets, transactional todo links, pending remote actions and revision-aware reads in Home and the scheduler. | Adding a todo twice creates one todo. Dismissing during ranking survives late responses, subsequent refreshes and restart. |
| 3. Mail conversations | Collect thread headers and mailbox generation, group connected messages, implement the incoming-message boundary and show which reply brought a conversation back. | Archiving the displayed message suppresses older messages in its thread. One new reply can produce one card. Unrelated same-subject messages stay distinct. |
| 4. Compatibility and release | Run backup, recurrence, account-switch and reader tests. Update Home help and both contributor guides for the new storage behavior. | Fresh install, upgrade, retry after interruption and restore all pass against isolated homes. The first visible Feed after each path already honors stored decisions. |

### Release acceptance cases

Use synthetic mail, an injected clock, a controllable ranker, and a file-backed temporary database for restart tests. Use the normal FeedService entry points, FeedStore and the email reader for integration coverage.

- Hold a rank response open, dismiss its first card, start another refresh, then release the older response last. Verify the card stays absent in Home, cached and error responses, notifications, and after relaunch.
- Add a calendar event to todos while the scheduler collects. Retry the action from the old card. Verify one todo, one todo sync operation, one link, and zero visible cards for the handled occurrence.
- Archive message B in a thread containing A and B. Rediscover A, receive C, then replay the original archive request. Verify exactly one card for C and that C remains in the inbox. Repeat with missing thread headers, identical subjects across accounts, reversed scan order and a changed mailbox generation.
- Verify a dismissed item after 31 days, a snooze across its local morning boundary, edits to a dismissed recurring occurrence, and the next occurrence becoming independently eligible.
- Interrupt migration and retry. Simulate a failed database write, a definitive provider rejection, and a timeout after a remote success. Verify the UI reports the appropriate outcome and repeating an action cannot duplicate its effect.
- Round-trip a backup and check decisions, instructions, feedback, links, and notification history. Verify a fresh home and a home with partial legacy cache data independently.

Run focused TobyStore, TobyCore and TobyApp tests per increment, followed by the package suite. Compare any known ViewInspector or signal-5 failures against the baseline using the repository’s non-parallel test procedure. All fixtures and upgrade rehearsals use scratch Toby homes.
