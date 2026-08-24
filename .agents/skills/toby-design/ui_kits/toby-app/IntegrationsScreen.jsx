const { SettingsCard, SettingsRow, SettingsSectionHeader, Button, InlineStatusMessage, Chip, Toggle, Select } = window.TobyDesignSystem_28de33;

function IntegrationsScreen({ selected, onSelect }) {
  const list = window.TobyKitData.integrations;
  const item = list.find((i) => i.id === selected) || list[0];
  const tone = item.status === 'Connected' ? 'success' : 'error';
  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border-hairline)', padding: '12px 8px', overflow: 'auto' }}>
        {list.map((i) => (
          <button key={i.id} type="button" onClick={() => onSelect(i.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '8px 10px',
              border: 'none', borderRadius: 'var(--radius-row)', cursor: 'pointer',
              background: i.id === item.id ? 'var(--surface-selected-strong)' : 'transparent' }}>
            <img src={'../../assets/icons/integrations/' + i.id + '.png'} alt="" width="20" height="20" style={{ objectFit: 'contain' }} />
            <span style={{ fontSize: 'var(--size-callout)', fontWeight: 'var(--weight-medium)', color: 'var(--text-body)' }}>{i.label}</span>
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--pad-content)' }}>
        <div style={{ maxWidth: 'var(--settings-content-max)', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={'../../assets/icons/integrations/' + item.id + '.png'} alt="" width="40" height="40" style={{ objectFit: 'contain' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 'var(--size-title2)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-body)' }}>{item.label}</span>
              <span style={{ fontSize: 'var(--size-subheadline)', color: 'var(--text-muted)' }}>{'@toby/plugin-' + item.id}</span>
            </div>
            <span style={{ flex: 1 }} />
            <Button>{item.status === 'Connected' ? 'Reconnect' : 'Connect'}</Button>
          </div>
          <InlineStatusMessage tone={tone} message={item.status === 'Connected' ? 'Connected. Last sync 4 minutes ago.' : 'Not connected yet. Run the setup wizard to add credentials.'} />
          <div style={{ fontSize: 'var(--size-card-body)', color: 'var(--text-muted)', lineHeight: 1.6, textWrap: 'pretty' }}>{item.summary}</div>
          <div>
            <SettingsSectionHeader>Tools exposed to chat</SettingsSectionHeader>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {item.tools.map((t) => <Chip key={t} label={t} />)}
            </div>
          </div>
          <div>
            <SettingsSectionHeader>Configuration</SettingsSectionHeader>
            <SettingsCard>
              <SettingsRow title="Enabled" description="Turn the integration off without removing credentials."><Toggle checked={item.status === 'Connected'} label="Enabled" /></SettingsRow>
              <SettingsRow title="Sync interval" description="How often background flows refresh this source."><Select value="15" options={[{ value: '5', label: 'Every 5 minutes' }, { value: '15', label: 'Every 15 minutes' }, { value: '60', label: 'Hourly' }]} /></SettingsRow>
              <SettingsRow title="Setup guide" description="Open the help site page for this integration." showsDivider={false}><Button external>Open guide</Button></SettingsRow>
            </SettingsCard>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { IntegrationsScreen });
