The container for every settings group: 10px radius, 1px card border, no shadow, capped at 640px.

```jsx
<SettingsSectionHeader>Appearance</SettingsSectionHeader>
<SettingsCard>
  <SettingsRow title="Theme" description="Follow the system or pin light/dark."><Select … /></SettingsRow>
  <SettingsRow title="Launch at login" showsDivider={false}><Toggle checked /></SettingsRow>
</SettingsCard>
```
