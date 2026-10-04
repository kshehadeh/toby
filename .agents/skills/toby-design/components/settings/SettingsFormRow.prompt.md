One row inside a `SettingsGroup`: the label on the left, the control on the right, an optional one-sentence description under the label.

```jsx
<SettingsFormRow label="Client ID">
  <input aria-label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
</SettingsFormRow>
```

Keep labels short ("Bot token", not "Bot Token (xoxb-...) — required for daemon/inbound"); put the rest in the description and the field's placeholder. **Native:** `LabeledContent`, or `TextField(label, text:, prompt:)` inside a grouped `Form`.
