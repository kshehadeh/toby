The assistant's answer: plain SF Pro at 15px with 6pt of extra line spacing, left-aligned in the 720px reading column, followed by a copy glyph and a relative timestamp.

```jsx
<AssistantMessage timestamp="2m ago">
  <p>Good morning! Here's a quick check-in.</p>
</AssistantMessage>
```

There is no avatar, persona label or serif face: the answer reads as the page itself. Put markdown output straight in `children`; hide the actions row while streaming with `streaming`.

**Native:** `Features/Chat/AssistantMessageRow.swift` (`AppTheme.transcriptAnswerFont`, `transcriptAnswerLineSpacing`, `transcriptReadingWidth`).
