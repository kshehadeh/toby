Inline success/error strip for form feedback and connection health. Prefer a Toast for ephemeral global notices.

```jsx
<InlineStatusMessage tone="error" message="Couldn't reach the daemon. Try restarting the server." />
```

Uses the dedicated status tokens (tinted background + 45%/40% border + darkened foreground) — never raw red/green.
