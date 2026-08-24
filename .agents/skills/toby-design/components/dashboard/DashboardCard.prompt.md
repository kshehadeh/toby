The dashboard's only card shape. Flat panel, 26px padding, a 2px accent rule capping the top, and a huge flat glyph at 4.5% opacity in the lower-right corner — no border, no divider, no rotation, no shadow. Summary copy is serif, matching assistant answers.

```jsx
<DashboardCard title="Unread mail" lastRan="07:15" stamp={<Mail size={120} />} showMore
  actions={<RefreshAndMenu />}>
  <CardSection label="Needs attention">Priya asked for the signed renewal before Friday.</CardSection>
  <CardSection label="Worth noting">Two CI failure digests and a calendar conflict.</CardSection>
</DashboardCard>
```

Collapsed to 340px so a row of cards aligns; long summaries end in the gradient fade plus the "Show more" bar. Section labels are 10px uppercase with +0.09em tracking — the only uppercase in the card.
