Setup-checklist tile. Exactly one tile per checklist is `upNext` — that is the only accent-filled CTA on the dashboard.

```jsx
<OnboardingTile upNext title="Connect an integration" subtitle="Email, Slack, Jira, Todoist, or Apple Calendar." actionLabel="Connect" glyph={<Grid />} />
<OnboardingTile complete title="Set up AI" subtitle="Provider and model chosen." glyph={<Sparkles />} />
```

Complete tiles fade the title to faint, show an accent check, and label themselves "Completed" in green.
