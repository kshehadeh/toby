Standard Toby text button — use it for settings actions, card actions, and wizard steps; `prominent` is reserved for the single primary action in a view.

```jsx
<Button variant="prominent" wide onClick={run}>Run Now</Button>
<Button onClick={openDocs} external>Open setup guide</Button>
<Button variant="destructive">Delete persona</Button>
```

Variants: `bordered` (default), `prominent` (accent fill, near-black label), `plain` (accent text only — used inline in toasts and transcripts), `destructive`. Props: `wide`, `disabled`, `external`.
