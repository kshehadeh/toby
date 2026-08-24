Switch control for boolean settings. Always labels-hidden inside a SettingsRow.

```jsx
<Toggle checked={launchAtLogin} label="Launch at login" onChange={setLaunchAtLogin} />
```

Deliberately green (#33c759) rather than accent-tinted — matches SettingsDesign.toggleTint.
