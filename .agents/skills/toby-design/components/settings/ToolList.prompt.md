"What Toby can do in …": an integration's tools, each with an icon for what it does (magnifying glass for search, pencil for update…), the first sentence of its description, and a "Makes changes" tag on tools that write. Shows three, then "Show all N tools".

```jsx
<ToolList integration="Slack" tools={[
  { name: 'Post to channel', description: 'Post a new message to a Slack channel, private channel, or DM.', writes: true, icon: <Send/> },
  { name: 'Search messages', description: 'Search Slack message history across the workspace.', icon: <Search/> },
]} />
```

**Native:** `IntegrationSettingsToolsAndGuideSections`; icons come from `FlowToolPickerModel.actionSymbol`.
