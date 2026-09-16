The user's turn: left-aligned quiet well, max 720px, elevated fill, concentric corners, no accent stripe. Same 15pt system sans as the answer.

```jsx
<UserMessage text="Summarize unread mail that needs a reply" footer={<CopyLink />} />
```

Prompts longer than 12 lines collapse with a "Show more" link. Copy and relative time sit under the well.
