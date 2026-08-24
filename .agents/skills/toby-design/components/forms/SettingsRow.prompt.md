One line of a settings form. Title is 13px semibold; description is 11px and always a full sentence.

```jsx
<SettingsRow title="Show menu bar icon" description="Keep Toby reachable from the macOS menu bar.">
  <Toggle checked onChange={setShow} />
</SettingsRow>
```

Min height 42px. Pass `showsDivider={false}` for the final row.
