The tool activity between a prompt and its answer: one quiet line, "Worked for 4s", in 13px secondary text with a disclosure chevron. Expanded, each step gets a row with its tool glyph in the markdown-heading blue, a 13px semibold title, a faint count or duration, and a one-line detail.

```jsx
<WorkStepRow label="Worked for 4s" expanded={open} onToggle={() => setOpen(!open)}
  steps={[{ glyph: <Mail />, title: 'Search mail', detail: '12 threads since Monday', count: 3 },
          { glyph: <FileText />, title: 'Read file', detail: '~/Documents/notes.md', path: true, duration: '0.4s' }]} />
```

While running, pass `running` and a label like "Working… 3s" for the pulsing accent dot; a failed group reads "Stopped after 2s" with the failing step marked. Consecutive calls to the same tool aggregate into one row with a `×n` count. Steps are no longer uppercase metadata lines.

**Native:** `Features/Chat/WorkedForRow.swift`.
