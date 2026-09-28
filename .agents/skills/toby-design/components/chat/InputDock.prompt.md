The chat composer: one Liquid Glass slab with 16px corners. The field is plain 13px text whose placeholder is the key hint; the control row has a grey circular attach button on the leading edge and, trailing, the context gauge, a stop button while loading, and the accent send button.

```jsx
<InputDock value={draft} onChange={setDraft} onSubmit={send} contextPercent={42}
  attachments={<Chip leading={<Paperclip />} label="terms.pdf" meta="88 KB" onRemove={remove} />} />
```

Float it over the transcript, pinned to the bottom. The glass is a web stand-in (`.toby-glass`) for the native `.glassEffect()`. Enabled attach, cancel and send show a pointing-hand cursor and a quiet hover wash (16% on Send, 10% on the others).

**Native:** `UI/Primitives/InputDock.swift`.
