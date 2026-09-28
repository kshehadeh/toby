The bottom of the sidebar: the persona picker button (24px portrait with 4px corners, the persona name in 13px, a chevron.up.chevron.down) and the server status dot beside it.

```jsx
<PersonaFooter name="Toby" imageSrc="…" status="connected" onClick={openPicker} />
```

No fill at rest; 14% accent while the picker is open; a 16% accent fill with an accent stroke and pulse when it needs attention. The model name is not shown here.

**Native:** `Features/Sidebar/SidebarFooter.swift`.
