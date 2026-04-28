# Slash commands (`toby chat` TUI)

Slash commands for the Ink chat UI are defined in:

- `src/ui/chat/slash-commands/`

Each command is a self-contained module that exports a `SlashCommand` object.
The registry in `src/ui/chat/slash-commands/index.ts` is the single source of truth
used by:

- autocomplete suggestions in the input dock
- slash-command execution on Enter
- the help screen command list

## File layout

```
src/ui/chat/slash-commands/
  types.ts         # SlashCommand + runtime contract
  config.ts        # /config
  help.ts          # /help
  integration.ts   # /integration
  new.ts           # /new
  sessions.ts      # /sessions
  exit.ts          # /exit
  index.ts         # registry + suggestion/resolve helpers
```

## Add a new slash command

1. Create a new command file in `src/ui/chat/slash-commands/`, for example `refresh.ts`.
2. Export a `SlashCommand` object with:
   - `command` (must start with `/`)
   - `description` (used by autocomplete)
   - `helpText` (used by help screen)
   - `run(runtime)` (command behavior)
3. Register it in `src/ui/chat/slash-commands/index.ts` by adding it to `SLASH_COMMANDS`.
4. Use only runtime callbacks/context passed into `run(...)` instead of reaching into chat component state directly.
5. Run checks:
   - `bun run lint`
   - `bun run typecheck`
   - `bun run test`

## Notes

- Command matching is case-insensitive.
- If the user types a partial slash command and presses Enter, the currently highlighted suggestion is executed.
- If no command matches, chat shows an "Unknown command" hint instead of sending the slash token to the model.

