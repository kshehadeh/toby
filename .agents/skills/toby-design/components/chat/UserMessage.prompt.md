The user's prompt: a left-aligned bubble in the same 720px column as the answer, on the elevated fill at 92% with a hairline stroke and 14px corners, text in SF Pro 15.

```jsx
<UserMessage text="How are you today? Give me a short morning check-in." timestamp="2m ago" />
```

It is not right-aligned and has no accent edge. Long prompts collapse after 12 lines behind an accent "Show more" in the app.

**Native:** `Features/Chat/UserMessageRow.swift`.
