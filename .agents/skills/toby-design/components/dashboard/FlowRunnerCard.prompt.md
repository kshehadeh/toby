A runner-only flow on Home: a Shortcuts-style colored tile in the Actions rail, 68px tall with 16px corners, filled with the flow's color preset (teal by default). White glyph top-left, play glyph top-right, an 11px semibold title at the bottom.

```jsx
<FlowRunnerCard title="Weekly review" glyph={<GitBranch />} color="var(--toby-accent-blue)"
  description="Collects last week's work into one summary." running={isRunning} error={err} onRun={run} />
```

Tiles fill equal columns, at least 100px wide. Running swaps the glyph for a spinner and pulses the fill; an error prints in 10px red under the tile. The description is the hover help. Runner flows never take a 340px card slot, and the rail is omitted when there are none.

**Native:** `Features/Dashboard/DashboardActionRunnersRail.swift`.
