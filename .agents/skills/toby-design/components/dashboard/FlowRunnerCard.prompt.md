For flows that only run — no summary body to show. Same shell as `DashboardCard` (panel, cap rule, ghost glyph) so a mixed grid aligns, with the single prominent action pinned to the bottom.

```jsx
<FlowRunnerCard title="Weekly review" description="Collects last week's shipped work, open tasks, and calendar into one summary."
  stamp={<GitBranch size={120} />} running={isRunning} error={err} onRun={run} />
```

Run Now is the only accent-filled button on the dashboard besides the up-next onboarding tile — don't add a second.
