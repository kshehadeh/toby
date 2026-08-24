const { DashboardCard, CardSection, FlowRunnerCard, OnboardingTile, IconButton, ProgressBar, Skeleton } = window.TobyDesignSystem_28de33;

function OnboardingBlock() {
  const steps = window.TobyKitData.onboarding;
  const done = steps.filter((s) => s.complete).length;
  return (
    <div style={{ padding: 26, borderRadius: 'var(--radius-lg)', background: 'var(--surface-panel)', position: 'relative', overflow: 'hidden' }}>
      <span style={{ position: 'absolute', left: 26, right: 26, top: 0, height: 2, background: 'var(--toby-accent)', opacity: 0.85 }} />
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 18 }}>
        <span style={{ fontSize: 'var(--size-card-title)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-body)' }}>Finish setting up Toby</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--size-row-title)', fontWeight: 'var(--weight-medium)' }}>
          <span style={{ color: 'var(--text-accent)' }}>{done}</span>
          <span style={{ color: 'var(--text-muted)' }}>{' of ' + steps.length + ' done'}</span>
        </span>
      </div>
      <ProgressBar progress={done / steps.length} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--gap-tile)', marginTop: 18 }}>
        {steps.map((s) => (
          <OnboardingTile key={s.title} title={s.title} subtitle={s.subtitle} glyph={<Icon name={s.icon} size={15} />}
            actionLabel={s.action} upNext={s.upNext} complete={s.complete} />
        ))}
      </div>
    </div>
  );
}

function DashboardScreen({ refreshing, onRefresh }) {
  const blocks = window.TobyKitData.blocks;
  const [running, setRunning] = React.useState(false);
  const runFlow = () => { setRunning(true); setTimeout(() => setRunning(false), 1400); };
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 'var(--pad-content)', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <OnboardingBlock />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, alignItems: 'start' }}>
        {blocks.map((b) => (
          <DashboardCard key={b.id} title={b.title} lastRan={b.ranAt.split(' ')[1]} showMore={b.sections.length > 2}
            stamp={<Icon name={b.icon} size={120} />}
            actions={<React.Fragment>
              <IconButton label="Refresh" filled={false} tone="faint" size="sm" glyph={<Icon name="refresh-cw" size={11} />} onClick={() => onRefresh(b.id)} />
              <IconButton label="Actions" filled={false} tone="faint" size="sm" glyph={<Icon name="ellipsis" size={11} />} />
            </React.Fragment>}>
            {refreshing === b.id ? <Skeleton lines={4} /> : b.sections.map((s) => (
              <CardSection key={s.h} label={s.h}>{s.p}</CardSection>
            ))}
          </DashboardCard>
        ))}
        <div style={{ minHeight: 'var(--dashboard-card-collapsed)' }}>
          <FlowRunnerCard title="Weekly review" stamp={<Icon name="git-branch" size={120} />} running={running} onRun={runFlow}
            description="Collects last week's shipped work, open tasks, and calendar into one summary you can paste into a status update." />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DashboardScreen });
