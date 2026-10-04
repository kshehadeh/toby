A System Settings section: a 13px semibold title over rows on one rounded fill, separated by inset hairlines, with an optional one-sentence footer.

```jsx
<SettingsGroup title="Mentions" footer="Mentions use Slack's Socket Mode, so they need a bot token and an app token.">
  <SettingsFormRow label="Reply when someone @mentions Toby" description="Toby answers in the same thread.">
    <Toggle checked onChange={setOn} label="Reply when someone @mentions Toby" />
  </SettingsFormRow>
  <SecretField label="App token" saved />
</SettingsGroup>
```

Use it for every grouped settings page (integrations, AI providers). Stack groups 26px apart. **Native:** `Form { Section(title) { … } footer: { … } }` with `.tobySettingsFormStyle()`.
