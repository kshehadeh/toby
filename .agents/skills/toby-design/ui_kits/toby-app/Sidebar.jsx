const { SidebarSection, SidebarRow, SidebarActionGrid, PersonaFooter } = window.TobyDesignSystem_28de33;
const Icon = ({ name, size = 16 }) => <i data-lucide={name} style={{ width: size, height: size, display: 'inline-flex' }}></i>;

function ServerStatusButton() {
  return (
    <button type="button" title="Server running · daemon healthy" aria-label="Server status"
      style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer',
        color: 'var(--text-faint)', fontSize: 'var(--size-caption)', padding: '4px 6px', borderRadius: 'var(--radius-xs)' }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--control-toggle-on)' }} />
      <span>Running</span>
    </button>
  );
}

function TobySidebar({ route, onRoute, sessions, activeSession, onSession, personaOpen, onPersona }) {
  const data = window.TobyKitData;
  const items = data.routes.map((r) => ({ id: r.id, title: r.title, color: r.color, glyph: <Icon name={r.icon} size={18} /> }));
  const listFor = {
    chat: { title: 'Chats', rows: sessions.map((s) => ({ id: s.id, title: s.title, subtitle: s.subtitle, glyph: s.img ? <img src={'../../assets/icons/integrations/' + s.img + '.png'} alt="" width="16" height="16" /> : <Icon name={s.icon} />, trailing: s.awaiting ? <Icon name="message-circle-question" size={12} /> : null })) },
    integrations: { title: 'Connected', rows: data.integrations.map((i) => ({ id: i.id, title: i.label, subtitle: i.status, glyph: <img src={'../../assets/icons/integrations/' + i.id + '.png'} alt="" width="16" height="16" /> })) },
    dashboard: { title: 'Home', rows: data.blocks.map((b) => ({ id: b.id, title: b.title, subtitle: 'Flow block', glyph: <Icon name={b.icon} /> })) }
  }[route] || { title: 'Recent', rows: sessions.slice(0, 3).map((s) => ({ id: s.id, title: s.title, subtitle: s.subtitle, glyph: <Icon name="message-square" /> })) };

  return (
    <aside style={{ width: 'var(--sidebar-width)', flexShrink: 0, background: 'var(--surface-sidebar)', padding: 'var(--pad-sidebar-y) var(--pad-sidebar-x)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 14px' }}>
        <img src="../../assets/logo/toby-128.png" alt="" width="33" height="33" />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 'var(--size-wordmark)', fontWeight: 'var(--weight-bold)', color: 'var(--text-body)', lineHeight: 1.1 }}>TOBY</span>
          <span style={{ fontSize: 'var(--size-caption)', color: 'var(--text-faint)' }}>v1.42.0</span>
        </div>
        <span style={{ flex: 1 }} />
        <ServerStatusButton />
      </div>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 16 }}>
        <SidebarSection title={listFor.title}>
          {listFor.rows.map((r) => (
            <SidebarRow key={r.id} title={r.title} subtitle={r.subtitle} glyph={r.glyph} trailing={r.trailing}
              selected={r.id === activeSession} onClick={() => onSession(r.id)} />
          ))}
        </SidebarSection>
      </div>
      <div style={{ height: 1, background: 'var(--border-hairline)', opacity: 0.5 }} />
      <SidebarActionGrid items={items} selectedId={route} onSelect={onRoute} />
      <div style={{ height: 1, background: 'var(--border-hairline)', opacity: 0.5 }} />
      <div style={{ paddingTop: 8 }}>
        <PersonaFooter name="Toby" model="gpt-4.1 · openai" imageSrc="../../assets/personas/toby.png" open={personaOpen} onClick={onPersona} />
      </div>
    </aside>
  );
}

Object.assign(window, { TobySidebar, Icon });
