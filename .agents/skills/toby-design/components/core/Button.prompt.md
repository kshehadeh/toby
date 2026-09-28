Standard push button. On macOS 26 every push button is a capsule: use `bordered` (grey capsule) for ordinary actions and `prominent` (accent capsule) for the one primary action in a view.

```jsx
<Button onClick={test}>Test connection</Button>
<Button variant="prominent">Save</Button>
<Button external onClick={openDocs}>Open setup guide</Button>
<Button variant="destructive">Delete persona</Button>
```

`plain` is accent text for inline actions (toasts, transcripts). Props: `wide`, `disabled`, `external`.
