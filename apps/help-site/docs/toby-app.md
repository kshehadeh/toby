---
title: Toby app tour
---

# Toby app tour

This page shows you around the Toby app: what each area is for, where to find
things, and how to customize it. Each section links to a full guide.

## The main window

![The Toby main window: sidebar on the left, a chat in the middle, toolbar at the top](/img/toby-app-main.png)

- **Sidebar (left).** Switch between areas: **Home**, **Chats**,
  **Projects**, **Library**, and **Recordings**; then **Schedules** and
  **Flows** under *Automation*; and **Skills** under *Tools*.
- **Bottom of the sidebar.** The persona picker on the left chooses which
  [persona](./personas) new chats use. The colored dot on the right shows
  whether Toby's background service is healthy. Green means everything is
  working. Click the dot for details or to restart it.
- **Toolbar (top right).** **Record** (●) starts a meeting recording,
  **Settings** (gear) opens settings, and **Search** opens the command
  palette. A second group holds actions for the current screen, such as
  **New**, **Edit**, **Run now**, or **Delete**.
- **Lists.** Areas that hold many items (chats, projects, recordings, and so
  on) show a list in the middle column. Click an item to open it. Click empty
  space in the list to go back to the overview.

## Home

Home is your daily dashboard. It shows cards for **Upcoming** events,
**Tasks**, and **Unread mail** (once those apps are connected), each with a
short AI summary. **Continue working** lists your five most recent chats and
projects.

![Home with Upcoming, Tasks, Unread mail, and Continue working cards](/img/toby-app-home.png)

Cards and buttons you create with [flows](./flows) also appear here: cards in
the grid, and one-click buttons in the **Actions** strip on the right.
Rows that link somewhere, such as a news article or a task, open when you
click them.

### Customize Home

Click **Edit Home** (pencil icon) in the toolbar. While editing you can:

- **Drag** cards to reorder them.
- **Hide** a card. Hidden cards move to a **Hidden cards** area. Click
  **Show** to bring one back.
- **Color** a card with the palette button. **Use default** follows the
  flow's own color; **Neutral** removes color.

![A Home card with a blue border and tint in light mode](/img/toby-app-home-color-light.png)

![The same card in dark mode](/img/toby-app-home-color-dark.png)

Click **Done** or press **Escape** when finished. Your layout is saved on this
Mac.

More options are under **Settings → Home**:

- **Home persona** chooses the persona that writes the card summaries. A fast,
  non-reasoning model works best (models labeled **· reasoning** sometimes
  include their working notes).
- **Show unread mail / tasks / upcoming events** turns the built-in cards on
  or off. Events come from your default calendar (see
  [Default providers](./configuration/default-providers)).
- **Hide onboarding checklist** hides the setup checklist. You can also click
  **Hide** next to the checklist's progress count.
- **Reset Home layout** restores the default card order, colors, and
  visibility.

## Chats

Where you talk to Toby. Press **⌘N** for a new chat, or use the arrow next to
**+** to start one with a specific persona. See
[Your first chat](./getting-started/first-chat).

## Projects

A project keeps the chats, instructions, and files for one piece of work
together. See [Projects](./projects).

![A project's Details tab with its summary, folder, and files](/img/toby-app-projects.png)

## Library

Files you want Toby to remember and search, such as PDFs, notes, and images.
See [Library](./library).

## Recordings

Meeting and call recordings with transcripts and AI summaries. See
[Recordings](./listen).

## Schedules and Flows

**Schedules** run a request automatically on a timetable. **Flows** are
step-by-step recipes that can power Home cards and one-click buttons. See
[Schedules](./schedules) and [Flows](./flows).

## Skills

Instructions that teach Toby how to do a specific task your way. See
[Skills](./skills).

## Memories

Facts and preferences Toby remembers about you. Memories open in their own
window: **View → Memories** (**⌘6**). See [Memories](./memories).

## Command palette

Press **⌘K** (or click **Search**) to jump to any chat, project, recording,
setting, or action by typing part of its name. If you type a sentence that
doesn't match anything, such as "summarize my day", choose **Start a chat
with…** and Toby opens a new chat with that request.

## Keyboard shortcuts

| Shortcut | Action |
| -------- | ------ |
| **⌘N** | New chat (or a new project chat when a project is selected) |
| **⌘K** | Command palette |
| **⌘,** | Settings |
| **⌘1** | Home |
| **⌘2** | Chats |
| **⌘3** | Settings → Integrations |
| **⌘4** | Projects |
| **⌘5** | Skills |
| **⌘6** | Memories |
| **⌘7** | Schedules |
| **⌘8** | Flows |
| **⌘9** | Recordings |
| **⌘0** | Library |
| **⌘?** | Open this help site |

In **Settings → General** you can also set system-wide shortcuts that work
even when Toby is in the background: open the command palette, start or stop a
recording, or start a new chat.

## Settings

Open **Settings** with the gear button or **⌘,**. Pick a section on the left.
Most sections have their own guide. See [Settings overview](./configuration/overview).

### General

These preferences apply to this Mac only.

| Setting | What it does | Default |
| ------- | ------------ | ------- |
| **Home directory** | The folder where Toby keeps your data. Changing it points Toby at a different folder. It doesn't copy anything. | `~/.toby` |
| **Start at login** | Open Toby automatically when you log in | Off |
| **Show menu bar icon** | Quick access to chat, recording, and windows from the menu bar | On |
| **Global shortcuts** | System-wide shortcuts for the command palette, recording, and new chat | Not set |
| **Chat mode** | **Normal** shows the conversation plus a collapsible *Worked for* summary of each step. **Debug** adds technical detail for troubleshooting. | Normal |
| **Theme** | System, Light, or Dark | System |
| **Accent color** | Color for buttons and highlights | Orange |

## Menus

| Menu item | What it does |
| --------- | ------------ |
| **File → New Chat / Schedule / Skill / Project / Memory** | Create a new item |
| **File → Permissions…** | Review the macOS permissions Toby uses (microphone, calendar, location, and so on) and grant any that are missing |
| **File → Backup Toby Data… / Restore Toby Data…** | Save or restore an encrypted backup of everything. See [Security](./security#backup-and-restore). |
| **View → Connection Status…** | Check the background service and inbound chat |
| **Help → Toby Help** | Open this site |
| **Help → Report an Issue…** | Send a bug report |

## Troubleshooting

- **The status dot isn't green, or Toby isn't responding.** Click the dot and
  choose **Restart server**, or open the command palette (**⌘K**) and run
  **Restart server**. Quitting and reopening Toby also works.
- **An integration stopped working.** Open **Settings → Integrations**, pick
  it, and click **Re-connect**.
- **macOS didn't ask for a permission, or you clicked Don't Allow.** Open
  **File → Permissions…** and click **Allow**, or **Open System Settings**
  if it was previously denied.
- **Something else.** Use **Help → Report an Issue…**.

For how the app and its background service fit together, see
[Architecture](./architecture/overview).
