For flows that only run — no summary body to show. Compact **Actions** rail
icon grid beside the card grid (64×64 flow SF Symbol). Hover 1s shows the
title and description; optional captions via Settings → Home. Do not occupy
a 340px card slot.

```jsx
<FlowRunnerCard title="Weekly review" description="Collects last week's shipped work, open tasks, and calendar into one summary."
  running={isRunning} error={err} onRun={run} />
```

The rail is omitted when there are no runner flows. While running, disable the
tile and replace the glyph with a progress indicator.
