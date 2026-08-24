For flows that only run — no summary body to show. Compact **Actions** rail
row beside the card grid (title is the button). Hover shows the description;
do not occupy a 340px card slot.

```jsx
<FlowRunnerCard title="Weekly review" description="Collects last week's shipped work, open tasks, and calendar into one summary."
  running={isRunning} error={err} onRun={run} />
```

The rail is omitted when there are no runner flows. While running, disable the
row and replace the play glyph with a progress indicator — keep the title.
