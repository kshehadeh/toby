For flows that only run — no summary body to show. Compact **Actions** rail
of Shortcuts-style colored tiles (flow SF Symbol, play glyph, and name).
Color comes from the flow editor. Hover 1s shows the title and description.
Do not occupy a 340px card slot.

```jsx
<FlowRunnerCard title="Weekly review" description="Collects last week's shipped work, open tasks, and calendar into one summary."
  running={isRunning} error={err} onRun={run} />
```

The rail is omitted when there are no runner flows. While running, disable the
tile and replace the glyph with a progress indicator.
