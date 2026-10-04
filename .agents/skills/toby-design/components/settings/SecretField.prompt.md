A secret in a settings form. Saved, it reads "✓ Saved" with a Change… button; Change… opens an empty secure field with Done. Not saved, it is a right-aligned secure field showing the placeholder.

```jsx
<SecretField label="App token" saved />
<SecretField label="Bot token" placeholder="xoxb-…" value={token} onChange={setToken} />
```

Never show dots plus a "value is saved" sentence. **Native:** `SettingsSecretFieldRow` (`UI/SettingsControls/SettingsSecretFieldRow.swift`).
