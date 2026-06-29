---
sidebar_position: 6
title: Memories
---

# Memories

**Memories** are durable facts Toby keeps about you—preferences, projects, relationships, and other context—so future chats do not start from zero.

Memories are stored separately from chat history in `~/.toby/memory.sqlite`. They are not a copy of your email or calendar; integrations remain the source of truth for live data.

## How memories help

- **Preferences** — “I prefer morning meetings,” “Use bullet summaries”
- **Projects** — Current initiative names, roles, or deadlines you have told Toby about
- **Relationships** — How you refer to people or teams (with your approval for sensitive details)
- **Continuity** — Schedules and later chat sessions can reuse context without re-explaining

## How memories are added

There is no separate `toby memory` command today. Memories are created through **conversation**:

1. You share something worth remembering, or Toby notices a stable preference from your work.
2. Toby **proposes** a memory (you may see tool feedback in the transcript).
3. Low-risk, high-confidence preferences may be **saved automatically**.
4. Sensitive or personal topics stay **pending** until you confirm.

You can also ask directly:

- “Remember that I prefer morning meetings.”
- “Save that my main project this quarter is called Northstar.”

## Privacy and confirmation

Toby classifies memory sensitivity:

- **Normal** preferences may auto-save when confidence is high enough.
- **Sensitive** or **restricted** topics (health, politics, finances, precise location, and similar) always require your explicit confirmation before they are stored.

You can ask Toby to **forget** a memory or **explain** where one came from (provenance and audit trail).

## What you see in chat

Memory operations appear as tool activity in the transcript, for example:

- Proposing or saving a memory
- Searching or retrieving memories for a task
- Forgetting a memory

Approve or reject pending items when Toby asks.

## Example prompts

| Goal | Example |
| ---- | ------- |
| Save a preference | “Remember I like standups at 10am Pacific.” |
| Recall context | “What do you already know about my current projects?” |
| Remove something | “Forget the memory about my old apartment address.” |
| Inspect | “Explain why you think I prefer async updates.” |

## Memories vs chat history

| | Chat session | Memory |
| --- | ------------ | ------ |
| **Stores** | Full conversation transcript | Compact facts and preferences |
| **File** | `~/.toby/chat.sqlite` | `~/.toby/memory.sqlite` |
| **Lifespan** | Per session / history | Until you forget or it expires |

## Related

- [Examples](./examples)
- [Schedules](./schedules) — scheduled runs can also propose and use memories
