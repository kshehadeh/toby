The destination switcher: a 3-column grid of icon-only buttons, each with its own identity hue. Hover/selected states are 18%/22% washes of that hue.

```jsx
<SidebarActionGrid selectedId="chat" onSelect={setRoute} items={[
  { id: 'dashboard', title: 'Dashboard', color: 'var(--toby-route-dashboard)', glyph: <Layout /> },
  { id: 'chat', title: 'Chats', color: 'var(--toby-route-chats)', glyph: <Message /> },
]} />
```

Hovering for 600ms in the app reveals a help popover with a one-sentence description — copy that pattern if you need tooltips.
