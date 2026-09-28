The Home card: content-background fill, a 1px separator stroke, 16px corners and 16px padding. The header is a 14px glyph, a 14px semibold title, the "last ran" time in 11px tertiary, a refresh glyph and an accent … menu, closed by a divider.

```jsx
<DashboardCard title="Unread mail" glyph={<Mail />} lastRan="9/18/26 07:08" onRefresh={refresh}>
  You're all caught up. No unread mail.
</DashboardCard>
```

Summary text is 13px secondary SF Pro. Cards keep their natural height up to 340px; past that pass `showMore` for the 40px fade and 36px "Show more" bar. There is no accent cap rule, no corner glyph and no serif. Use `CardSection` for structured content (eyebrow, title, body, item rows).

**Native:** `Features/Dashboard/DashboardCards.swift`, `DashboardBlockChrome.swift`.
