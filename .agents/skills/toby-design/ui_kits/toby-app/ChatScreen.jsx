const { InputDock, UserMessage, AssistantMessage, WorkStepRow, Button } = window.TobyDesignSystem_28de33;

function SuggestionList({ onPick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {window.TobyKitData.suggestions.map((s) => (
        <button key={s.text} type="button" onClick={() => onPick(s.text)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', border: 'none', borderBottom: '1px solid var(--border-hairline)',
            background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text-muted)', fontSize: 'var(--size-callout)' }}>
          <span style={{ width: 16, display: 'inline-flex', color: 'var(--text-faint)' }}><Icon name={s.icon} size={14} /></span>
          <span>{s.text}</span>
        </button>
      ))}
    </div>
  );
}

function ChatScreen({ turns, draft, setDraft, onSend }) {
  const empty = turns.length === 0;
  if (empty) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 var(--pad-content)' }}>
        <div style={{ width: 560, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <img src="../../assets/personas/toby.png" alt="" width="96" height="96" style={{ borderRadius: 999 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--size-title2)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-body)' }}>What should Toby take care of?</span>
              <span style={{ fontSize: 'var(--size-callout)', color: 'var(--text-muted)', textAlign: 'center' }}>Use your connected apps, schedules, memory, and Mac controls from one place.</span>
            </div>
          </div>
          <InputDock value={draft} onChange={setDraft} onSubmit={onSend} contextPercent={12} />
          <SuggestionList onPick={setDraft} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      <div style={{ height: '100%', overflow: 'auto', padding: 'var(--pad-content) var(--pad-content) 150px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {turns.map((t, i) => (
            <React.Fragment key={i}>
              <UserMessage text={t.prompt} footer={<Button variant="plain">Copy prompt</Button>} />
              <div>
                {t.steps.map((s) => (
                  <WorkStepRow key={s.title} title={s.title} body={s.body} duration={s.duration} count={s.count}
                    glyph={s.icon ? <Icon name={s.icon} size={11} /> : null} active={s.active} expandable={!!s.body} />
                ))}
              </div>
              {t.answer ? (
                <AssistantMessage header="Toby" avatarSrc="../../assets/personas/toby.png" footer={<Button variant="plain">Copy response</Button>}>
                  {t.answer.split('\n\n').map((p, j) => <p key={j} style={{ margin: j ? '12px 0 0' : 0 }}>{p}</p>)}
                </AssistantMessage>
              ) : null}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '0 var(--pad-content) 18px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <InputDock value={draft} onChange={setDraft} onSubmit={onSend} contextPercent={42} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ChatScreen });
