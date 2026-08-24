window.TobyKitData = {
  sessions: [
    { id: 's1', title: 'Weekly review prep', subtitle: '4 messages', icon: 'message-square' },
    { id: 's2', title: 'Jira triage', subtitle: '11:20', img: 'jira' },
    { id: 's3', title: 'Inbox digest', subtitle: 'Awaiting reply', img: 'email', awaiting: true },
    { id: 's4', title: 'Renewal thread', subtitle: 'Yesterday', icon: 'message-square' },
    { id: 's5', title: 'Standup notes from Tuesday', subtitle: 'Aug 19', icon: 'message-square' }
  ],
  routes: [
    { id: 'dashboard', title: 'Dashboard', icon: 'layout-grid', color: 'var(--toby-route-dashboard)', detail: 'See what needs your attention: unread mail, open tasks, and setup steps at a glance.' },
    { id: 'chat', title: 'Chats', icon: 'message-square', color: 'var(--toby-route-chats)', detail: 'Open your chat workspace, continue existing conversations, or start a new session with Toby.' },
    { id: 'integrations', title: 'Integrations', icon: 'grid-2x2', color: 'var(--toby-route-integrations)', detail: 'Manage connected services, credentials, setup guides, and integration-specific capabilities.' },
    { id: 'projects', title: 'Projects', icon: 'folder', color: 'var(--toby-route-projects)', detail: 'Work inside project folders with scoped chats, local guidance, skills, and generated outputs.' },
    { id: 'skills', title: 'Skills', icon: 'sparkles', color: 'var(--toby-route-skills)', detail: 'Browse installed skills, inspect their instructions, edit them, or add new reusable workflows.' },
    { id: 'memories', title: 'Memories', icon: 'brain', color: 'var(--toby-route-memories)', detail: 'Browse, create, edit, and delete memories Toby remembers across chats and automations.' },
    { id: 'schedules', title: 'Schedules', icon: 'clock', color: 'var(--toby-route-schedules)', detail: "Create and monitor recurring prompts that run on a schedule through Toby's background daemon." },
    { id: 'flows', title: 'Flows', icon: 'git-branch', color: 'var(--toby-route-flows)', detail: 'Browse named flow pipelines, inspect their nodes, and review recent execution history.' },
    { id: 'recordings', title: 'Recordings', icon: 'audio-lines', color: 'var(--toby-route-recordings)', detail: 'Review audio recordings, transcripts, and chats created from recorded context.' }
  ],
  suggestions: [
    { text: 'Show me today’s calendar and conflicts', icon: 'calendar' },
    { text: 'Summarize unread mail that needs a reply', icon: 'mail' },
    { text: 'Create a recurring schedule for my weekly review', icon: 'clock' },
    { text: 'Find open tasks that are blocked or stale', icon: 'list-checks' },
    { text: 'Turn on Focus and minimize distracting windows', icon: 'app-window' }
  ],
  integrations: [
    { id: 'email', label: 'Email', status: 'Connected', summary: 'IMAP + SMTP for one mailbox. Toby can search, summarize, draft, and send.', tools: ['search_mail', 'read_thread', 'draft_reply', 'send_mail'] },
    { id: 'todoist', label: 'Todoist', status: 'Connected', summary: 'Read and write tasks, projects, and due dates from chat.', tools: ['list_tasks', 'create_task', 'complete_task'] },
    { id: 'slack', label: 'Slack', status: 'Connected', summary: 'Read channels Toby is invited to, and answer @mentions as an inbound chat surface.', tools: ['list_channels', 'read_messages', 'post_message'] },
    { id: 'jira', label: 'Jira', status: 'Needs setup', summary: 'Track issues assigned to you, move tickets, and summarize sprint state.', tools: ['search_issues', 'transition_issue'] },
    { id: 'notion', label: 'Notion', status: 'Not connected', summary: 'Search pages and databases, append notes to a daily page.', tools: ['search_pages', 'append_block'] },
    { id: 'apple-calendar', label: 'Apple Calendar', status: 'Connected', summary: 'Native EventKit access to local calendars — no cloud round trip.', tools: ['list_events', 'create_event'] },
    { id: 'apple-reminders', label: 'Apple Reminders', status: 'Connected', summary: 'Read and create reminders in local lists.', tools: ['list_reminders', 'create_reminder'] },
    { id: 'macos', label: 'macOS', status: 'Connected', summary: 'Focus modes, window control, screenshots, and bundled Shortcuts.', tools: ['set_focus', 'run_shortcut', 'window_control'] }
  ],
  blocks: [
    { id: 'mail', title: 'Unread mail', icon: 'mail', ranAt: '8/24/26 07:15', sections: [
      { h: 'Needs attention', p: 'Priya asked for the signed renewal before Friday — the thread has been open since Thursday and nobody has replied.' },
      { h: 'Worth noting', p: 'Two CI failure digests, and a design-review invite for Thursday that conflicts with your 1:1.' },
      { h: 'Ignore', p: 'Nine newsletters and three receipts.' }
    ] },
    { id: 'tasks', title: 'Open tasks', icon: 'list-checks', ranAt: '8/24/26 07:15', sections: [
      { h: 'Overdue', p: 'Ship the plugin protocol doc (2 days late) and reply to the vendor security questionnaire.' },
      { h: 'Due today', p: 'Review the transcription settings PR, then write the weekly summary.' },
      { h: 'Stale', p: 'Four tasks have not moved in three weeks — most are blocked on the daemon rewrite.' }
    ] },
    { id: 'calendar', title: 'Upcoming events', icon: 'calendar', ranAt: '8/24/26 07:15', sections: [
      { h: 'Today', p: '10:00 Standup · 13:30 Design review · 16:00 1:1 with Priya (overlaps the review).' },
      { h: 'Tomorrow', p: 'Two blocks of focus time and a vendor call at 15:00.' }
    ] }
  ],
  onboarding: [
    { title: 'Set up AI', subtitle: 'Provider and model chosen.', icon: 'sparkles', complete: true },
    { title: 'Connect an integration', subtitle: 'Email, Slack, Jira, Todoist, or Apple Calendar.', icon: 'grid-2x2', action: 'Connect', upNext: true },
    { title: 'Create a persona', subtitle: 'Shape how Toby prioritizes and responds.', icon: 'user-round', action: 'Create' },
    { title: 'Add a schedule', subtitle: 'Run a prompt every morning.', icon: 'clock', action: 'Create' },
    { title: 'Record your first note', subtitle: 'Listen mode transcribes locally.', icon: 'audio-lines', action: 'Open Listen' },
    { title: 'Grant permissions', subtitle: 'Calendar, Contacts, microphone, automation.', icon: 'shield-check', action: 'Review' }
  ]
};
