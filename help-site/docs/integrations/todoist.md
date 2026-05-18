---
sidebar_position: 3
title: Todoist
---

# Todoist

Connect Toby to Todoist to manage tasks and projects from chat.

**CLI name:** `todoist`

## Prerequisites

- A Todoist account
- An API token from **Todoist → Settings → Integrations → Developer**

## Configure

```bash
toby config
```

Go to **Integrations → Todoist** and enter your **API Key**. Save.

## Connect

```bash
toby connect todoist
```

Toby validates the API key and marks Todoist as connected.

## Verify

```bash
toby status integration -i todoist
```

## Disconnect

```bash
toby disconnect todoist
```

## Example chat prompts

- “What tasks are due today across all projects?”
- “Add a task to follow up with Alex about the design review by Friday.”

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
