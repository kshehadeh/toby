const { SettingsCard, SettingsRow, SettingsSectionHeader, Toggle, Select, TextField, Button, Badge } = window.TobyDesignSystem_28de33;

const settingsTabs = [
  { id: 'general', label: 'General', icon: 'settings-2' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'ai', label: 'AI providers', icon: 'sparkles' },
  { id: 'personas', label: 'Personas', icon: 'user-round' },
  { id: 'sync', label: 'iCloud sync', icon: 'cloud' }
];

function SettingsScreen({ theme, setTheme, accent, setAccent, tab, setTab }) {
  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--surface-settings-canvas)', overflow: 'hidden' }}>
      <div style={{ width: 210, flexShrink: 0, borderRight: '1px solid var(--border-hairline)', padding: '12px 8px' }}>
        {settingsTabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '7px 10px',
              border: 'none', borderRadius: 'var(--radius-row)', cursor: 'pointer', marginBottom: 2,
              background: tab === t.id ? 'var(--surface-selected-strong)' : 'transparent',
              color: tab === t.id ? 'var(--text-body)' : 'var(--text-muted)', fontSize: 'var(--size-callout)' }}>
            <Icon name={t.icon} size={14} />{t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--pad-content)' }}>
        <div style={{ maxWidth: 'var(--settings-content-max)', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {tab === 'appearance' ? (
            <React.Fragment>
              <div>
                <SettingsSectionHeader>Theme</SettingsSectionHeader>
                <SettingsCard>
                  <SettingsRow title="Appearance" description="Follow the system setting or pin light / dark.">
                    <Select value={theme} onChange={setTheme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
                  </SettingsRow>
                  <SettingsRow title="Accent color" description="Tints selection, highlights, and the send button." showsDivider={false}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['orange', 'blue', 'green', 'purple', 'pink', 'red', 'teal', 'gray'].map((a) => (
                        <button key={a} type="button" aria-label={a} title={a} onClick={() => setAccent(a)}
                          style={{ width: 18, height: 18, borderRadius: 999, cursor: 'pointer',
                            background: 'var(--toby-accent-' + a + ')',
                            border: accent === a ? '2px solid var(--text-body)' : '1px solid var(--border-control)' }} />
                      ))}
                    </div>
                  </SettingsRow>
                </SettingsCard>
              </div>
              <div>
                <SettingsSectionHeader>Chat</SettingsSectionHeader>
                <SettingsCard>
                  <SettingsRow title="Transcript detail" description="Debug shows tools, prep, and selection notices.">
                    <Select value="normal" options={[{ value: 'normal', label: 'Normal' }, { value: 'debug', label: 'Debug' }]} />
                  </SettingsRow>
                  <SettingsRow title="Show dashboard onboarding" showsDivider={false}><Toggle checked label="Show onboarding" /></SettingsRow>
                </SettingsCard>
              </div>
            </React.Fragment>
          ) : tab === 'ai' ? (
            <React.Fragment>
              <div>
                <SettingsSectionHeader>Default provider</SettingsSectionHeader>
                <SettingsCard>
                  <SettingsRow title="Provider" description="Used by chat, dashboard summaries, and schedules.">
                    <Select value="openai" options={[{ value: 'openai', label: 'OpenAI' }, { value: 'ollama', label: 'Ollama (local)' }, { value: 'openrouter', label: 'OpenRouter' }, { value: 'vercel', label: 'Vercel AI Gateway' }]} />
                  </SettingsRow>
                  <SettingsRow title="Model" description="Reasoning models are marked in the list.">
                    <Select value="gpt-4.1" options={[{ value: 'gpt-4.1', label: 'gpt-4.1' }, { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' }, { value: 'o4-mini', label: 'o4-mini · reasoning' }]} />
                  </SettingsRow>
                  <SettingsRow title="API key" description="Stored in the macOS keychain, never in config.json." showsDivider={false}>
                    <TextField secure value="sk-live-8f21" placeholder="sk-…" />
                  </SettingsRow>
                </SettingsCard>
              </div>
              <div>
                <SettingsSectionHeader>Providers</SettingsSectionHeader>
                <SettingsCard>
                  {[['openai', 'OpenAI', 'Configured'], ['ollama', 'Ollama', 'Local · llama3.1'], ['openrouter', 'OpenRouter', 'Not configured'], ['vercel', 'Vercel AI Gateway', 'Not configured']].map((p, i, arr) => (
                    <SettingsRow key={p[0]} title={p[1]} description={p[2]} showsDivider={i < arr.length - 1}>
                      <img src={'../../assets/icons/ai/' + p[0] + '.png'} alt="" width="22" height="22" style={{ objectFit: 'contain' }} />
                      <Button>Configure</Button>
                    </SettingsRow>
                  ))}
                </SettingsCard>
              </div>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <div>
                <SettingsSectionHeader>Startup</SettingsSectionHeader>
                <SettingsCard>
                  <SettingsRow title="Open Toby at login" description="Starts the app and daemon when this Mac logs in."><Toggle label="Launch at login" /></SettingsRow>
                  <SettingsRow title="Show menu bar icon" description="Keep Toby reachable without the main window."><Toggle checked label="Menu bar icon" /></SettingsRow>
                  <SettingsRow title="Global shortcut" description="Opens the command palette from anywhere." showsDivider={false}>
                    <Badge>⌥ Space</Badge>
                  </SettingsRow>
                </SettingsCard>
              </div>
              <div>
                <SettingsSectionHeader>Data</SettingsSectionHeader>
                <SettingsCard>
                  <SettingsRow title="Toby directory" description="Config, sessions, memories, and plugins live here.">
                    <TextField value="~/.toby" maxWidth={200} />
                  </SettingsRow>
                  <SettingsRow title="Backup" description="Write an encrypted archive of config and credentials." showsDivider={false}>
                    <Button>Back up now</Button>
                  </SettingsRow>
                </SettingsCard>
              </div>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SettingsScreen });
