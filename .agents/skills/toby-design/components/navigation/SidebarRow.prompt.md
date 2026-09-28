Two row shapes. `variant="destination"` is a primary sidebar destination (Home, Chats, Projects, Library, Recordings, Schedules, Flows, Skills): a 16px glyph and 13px title in primary text, with the grey selection pill. The default `variant="browser"` is `FeatureBrowserRow`, the row of every list/detail column (Chats, Projects, Skills, Flows, Schedules, Recordings, Script Tools).

```jsx
<SidebarRow variant="destination" title="Home" glyph={<House />} selected />
<SidebarRow title="Calendar Summary" subtitle="Fetch upcoming events" badge="Built-in" glyph={<Calendar />} selected />
```

Browser rows: 20px glyph box (tertiary, accent when selected), 12px medium title (secondary, primary when selected), optional 9px badge capsule, 10px tertiary subtitle, 8/10 padding, 8px corners, selection fill only (no hover fill).

**Native:** `Features/Sidebar/AppSidebar.swift`, `FeatureBrowserRow.swift`.
