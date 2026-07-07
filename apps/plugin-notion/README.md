# Toby Notion plugin

First-party TypeScript bun-package plugin for using Notion as Toby's
Documents provider.

## Configure

1. Create a Notion personal access token or internal connection token in the
   Notion developer portal.
2. Share the pages/databases you want Toby to access with that connection.
3. Open `toby configure` and set:
   - `notion.apiKey`
   - `notion.defaultParentPageId` if you want page creation to work without
     passing a parent page id each time.
4. Run `toby connect notion`.

## Development

```bash
bun run build:plugin:notion
toby plugins install ./dist/toby-plugin-notion --link --force
toby plugins doctor
toby plugins inspect notion
```

## Tools

- `searchNotion`
- `getNotionPage`
- `listNotionBlockChildren`
- `createNotionPage`
- `appendNotionPageContent`
