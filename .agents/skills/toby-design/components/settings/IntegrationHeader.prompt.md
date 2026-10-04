The top of an integration's settings page: the app's own icon on a white tile, its name, a plain status and one action. Connect is prominent when disconnected; Re-authorize is prominent when it needs attention and quiet when healthy. Needing attention shows a "Needs attention" pill and one line with the plugin's details, never a red banner.

```jsx
<IntegrationHeader name="Slack" iconSrc={slackIcon} status="attention" signedInWith="Signed in with OAuth"
  issue="Plugin reported unhealthy status" onAction={reauthorize} />
```

Setup guide, plugin location and Disconnect go in an About group and a red row at the bottom, not here. **Native:** `Features/Configure/IntegrationDetailHeader.swift`.
