The first row of an integration's "Sign in" group: a segmented control over its auth methods. Only the chosen method's fields follow it.

```jsx
<SettingsGroup title="Sign in">
  <MethodPicker value="oauth" onChange={setMethod}
    options={[{ value: 'oauth', label: 'OAuth (recommended)' }, { value: 'bot_token', label: 'Bot token' }]} />
  <SettingsFormRow label="Client ID">…</SettingsFormRow>
</SettingsGroup>
```

"(recommended)" is dropped from the segment. Don't also list the methods elsewhere. **Native:** `Picker(.segmented)` inside `LabeledContent("Method")` in `IntegrationSettingsFieldSections`.
