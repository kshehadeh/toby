---
name: toby-screenshot-docs
description: Reliably capture Toby.app UI screenshots for the help site—discover what changed, navigate the live app with cua-driver, crop to the subject region, and publish PNGs under apps/help-site/static/img/. Use when the native UI changed or docs screenshots are stale.
---

# Capture Toby.app screenshots reliably

## Goal

Produce **accurate, region-focused** PNGs of the live Toby native macOS app for
the help site (`apps/help-site/static/img/toby-app-*.png`).

This skill is about **how to capture**, not a fixed catalog of doc pages.
Documentation paths and filenames change; the app’s navigation and window model
are the source of truth. Discover what to shoot, capture it the same way every
time, then update whatever markdown references those files.

## Core rules

1. **Always launch against the generic data home** (`TOBY_DIR=~/.toby-generic`).
   Never capture publishable screenshots from the real `~/.toby` home (personal
   chats, memories, mail, paths). Seed and launch as documented in Step 3.
2. **Discover before you shoot.** Find current surfaces from the app (and git
   when refreshing after UI work). Do not assume the sidebar list from an old
   skill revision is complete.
3. **Subject first.** Capture the UI the reader needs to see. Prefer a tight
   crop of the relevant pane/form/control over a default full-window dump.
4. **Full window only for orientation.** Use full-window shots when introducing
   a surface as a whole; use region crops for settings subsections, detail
   panes, and step-by-step flows.
5. **Never use cua-driver `zoom` for published assets.** It returns a small JPEG
   (≤500 px) meant for click targeting, not docs.
6. **No secrets, no private data, no agent-cursor overlays** in final PNGs.
7. **Snapshot before every click.** Element indices are per-snapshot and
   per-window; stale indices fail silently or hit the wrong control.

## Prerequisites

1. **cua-driver** on PATH (`which cua-driver`). Install if missing:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh | bash
   ```
2. **Daemon running:** `cua-driver status` — if not, `open -n -g -a CuaDriver --args serve`
3. **Permissions:** `cua-driver permissions status` (Accessibility + Screen Recording). Grant with `cua-driver permissions grant` if needed.
4. **Dev app built:** `bun run build:app` → `dist/Toby (Dev).app`, bundle ID `dev.karim.toby.app.dev`
5. **ImageMagick** (`magick` / `convert`) for crops (preferred over `sips`)
6. **Generic Toby home** (required for docs captures):
   ```bash
   bun run app:screenshots
   # seeds ~/.toby-generic if missing, builds Dev, launches with TOBY_DIR set
   # force rebuild: bun run app:screenshots -- --reseed
   ```

Optional: read the **cua-driver** skill for the full snapshot/action loop. This
skill only covers the screenshot-for-docs subset.

---

## Step 1 — Discover what to capture

Do not hardcode a permanent window inventory in your head. Re-derive it each run.

### 1a. Live app surfaces (authoritative)

After launch (Step 3), discover navigable UI from:

| Source | What it tells you |
| --- | --- |
| AX tree on main window | Sidebar / action labels you can click |
| `list_windows` for the pid | Open windows (Settings, Logs, Permissions, …) and titles |
| Code (when planning offline) | `DetailRoute` in `apps/toby-app/Sources/TobyApp/Utilities/NavigationHistory.swift` (sidebar routes); `Window(...)` / `openWindow(id:)` in `apps/toby-app/Sources/TobyApp/App/TobyApp.swift` (secondary windows); `Features/` under `apps/toby-app/Sources/TobyApp/Features/` (feature modules) |

As of this writing, main routes include **Dashboard, Chats, Projects,
Integrations, Schedules, Recordings, Skills, Memories**. Secondary windows
include **Settings, Logs, Permissions, Persona Editor**, plus sheets/modals
(onboarding, server info, backup/restore, etc.). Re-check code if unsure—new
routes appear without this skill being edited.

### 1b. What already exists in the help site

```bash
# All published app screenshots
ls apps/help-site/static/img/toby-app-*.png

# Where each is referenced
rg -n 'toby-app-.*\.png' apps/help-site/docs/
```

Use references only to know **filenames and which pages need an update**—not as
the exclusive list of subjects. New UI may need a new file name
(`toby-app-<surface>-<subject>.png`).

### 1c. What changed in the app (for refresh runs)

When the user asks to update screenshots after UI work, or when shots look
stale, scope the recapture set from git—not from a static table.

```bash
# Skill baseline commit (first added): 3b4c356a — 2026-06-24
SKILL_BASE=3b4c356a

# UI modules touched since the skill was introduced
git log --oneline ${SKILL_BASE}..HEAD -- apps/toby-app/

# Feature areas that exist now
ls apps/toby-app/Sources/TobyApp/Features/

# Routes / windows that may need coverage
rg -n 'enum DetailRoute|Window\(|openWindow\(id:' \
  apps/toby-app/Sources/TobyApp --glob '*.swift'
```

**Major app areas that did not exist or changed substantially since the skill
was first created** (baseline `3b4c356a`, 2026-06-24). Treat this as a
**discovery checklist for refresh work**, not as “always re-shoot everything”:

| Area | What changed (summary) | Capture notes |
| --- | --- | --- |
| **Dashboard** | New native dashboard, onboarding cards, metrics, recents | Main-window route; not in the original sidebar-only inventory |
| **Projects** | New Projects feature + canvas / inspector | Full surface + project inspector when docs mention workspace |
| **Memories** | New Memories management UI | Full surface + list/detail attributes when relevant |
| **Settings** | Preferences-style **Settings window**, hierarchy sidebar, Appearance (theme/accent), AI provider cards/tips, Default Providers cards | Open Settings window; crop per section (AI, Persona, Appearance, …) |
| **Integrations** | Two-column detail, inspector, tools list, layout cleanups | List overview vs per-integration detail crops |
| **Skills / Schedules / Recordings** | Inspector/editor layouts; recordings summary, in-progress, transcribe controls | Prefer inspector + selected list row when docs describe editing |
| **Chat** | Empty state logo, attachments, context fill, integration icons, streaming polish | Empty session vs example turn; crop transcript + composer when step-focused |
| **Logs** | Unified log UI, source views, search | Secondary **Logs** window |
| **Permissions / About / Server info** | Permissions window, About home dir, server info modal | Secondary windows / popovers as needed |
| **Menus** | File (backup/restore, new *), View routes, Help → docs | Only if docs illustrate menus; capture menu only when open and readable |
| **Theme** | Light / Dark / System + accent | Keep a set consistent; note Appearance settings if documenting them |

For a **partial** refresh (one feature PR), limit discovery to:

```bash
git log --oneline <base>..HEAD -- apps/toby-app/Sources/TobyApp/Features/<Feature>/
git diff <base>..HEAD --stat -- apps/toby-app/Sources/TobyApp/Features/<Feature>/
```

Then map changed views → live navigation path → existing or new PNG names via
`rg` on the help site.

### 1d. Build the shot list for this run

For each subject, write one line before capturing:

```text
filename | navigate path | region (full-window | content-pane | control)
```

Example:

```text
toby-app-settings-openai.png | Settings → AI → OpenAI | form + selected nav row
toby-app-projects.png        | Sidebar → Projects     | full surface (list + inspector)
```

---

## Step 2 — Session isolation

```bash
RUN_ID="$(date +%s)-$$"
RUN_DIR="$(mktemp -d /tmp/toby-shots-${RUN_ID}-XXXXXX)"
SESSION="${RUN_ID}-toby"

cua-driver start_session "{\"session\":\"$SESSION\"}"
# Hide agent cursor for clean docs PNGs
cua-driver set_agent_cursor_enabled "{\"enabled\":false,\"session\":\"$SESSION\"}"
```

Keep all raw and cropped files under `$RUN_DIR` until you copy into the repo.

---

## Step 3 — Launch against the generic home (required)

**Always** start Toby with `TOBY_DIR` pointing at `~/.toby-generic`. Do **not**
use plain `cua-driver launch_app` alone for docs shots — that opens the user’s
real `~/.toby` data.

### 3a–3c. Seed (if needed) + launch (recommended)

```bash
bun run app:screenshots
# force wipe/rebuild of demo data:
bun run app:screenshots -- --reseed

sleep 4

# Resolve pid of the Dev app
PID=$(cua-driver list_apps '{}' | python3 -c "
import json, sys
for a in json.load(sys.stdin).get('apps', []):
    if a.get('bundle_id') == 'dev.karim.toby.app.dev' and a.get('running') and a.get('pid'):
        print(a['pid']); break
")
if [ -z "$PID" ]; then
  PID=$(pgrep -f 'Toby \(Dev\)' | head -1)
fi
echo "PID=$PID"
```

That script seeds `~/.toby-generic` when missing/incomplete, builds Dev, quits a
leftover Dev process, and opens with `TOBY_DIR` + plaintext credentials via
`open --env` (shell exports alone are not reliable with LaunchServices).

Manual equivalent (if you need to customize):

```bash
python3 scripts/seed-toby-generic-home.py   # safe to re-run; only rebuilds dest
pkill -f 'Toby \(Dev\)' 2>/dev/null || true
sleep 1
open -n -g \
  --env "TOBY_DIR=${HOME}/.toby-generic" \
  --env "TOBY_CREDENTIALS_KEY_BACKEND=plaintext" \
  "$(pwd)/dist/Toby (Dev).app"
```

Notes:

- `-n` = new instance; `-g` = background (no focus steal).
- `TOBY_CREDENTIALS_KEY_BACKEND=plaintext` keeps demo credentials in
  `~/.toby-generic/credentials.json` readable without Keychain coupling to the
  real home.
- Confirm the app is on the generic home if unsure: chat list / memories should
  show demo names (e.g. Alex Rivera, Morning briefing), not personal data.
- After launch, drive the UI with **cua-driver** (`list_windows`,
  `get_window_state`, `click`, …) as usual. `launch_app` is fine for *other*
  apps; for Toby docs shots, **use `bun run app:screenshots` or the `open --env`
  path above**.

### 3d. Resolve windows

```bash
cua-driver list_windows "{\"pid\":$PID}"
```

Pick `window_id` by **title** and `is_on_screen`. Secondary surfaces
(Settings, Logs, Permissions) get their own window ids—always snapshot and click
against the **correct** `window_id`.

```bash
# Resolve main window (adjust title match if needed)
MAIN_WID=$(cua-driver list_windows "{\"pid\":$PID}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for w in data.get('windows', []):
    title = (w.get('title') or '')
    if w.get('is_on_screen') and ('Toby' in title):
        print(w['window_id']); break
")
```

---

## Step 4 — Navigate reliably

### Snapshot modes

| `capture_mode` | Use when |
| --- | --- |
| `ax` | Need element indices only (cheaper) |
| `som` | Need tree **and** PNG (default for capture) |
| `vision` | Pixels only (rare for this workflow) |

### Click by label

```bash
# Fresh indices every time
cua-driver get_window_state \
  "{\"pid\":$PID,\"window_id\":$WID,\"capture_mode\":\"ax\"}" | python3 -c "
import json, sys
want = sys.argv[1].lower().strip()
data = json.load(sys.stdin)
for el in data.get('elements') or []:
    label = (el.get('label') or '').lower().strip()
    role = (el.get('role') or '').lower()
    if label == want and 'menu' not in role:
        print(el['element_index']); break
" "Projects"

cua-driver click "{\"pid\":$PID,\"window_id\":$WID,\"element_index\":<idx>,\"session\":\"$SESSION\"}"
sleep 1  # 1–2s after navigation; longer if the pane loads data
```

### Navigation patterns

- **Main routes:** click sidebar / action grid labels that match `DetailRoute.menuTitle` (or current AX labels). Re-snapshot main window before each click.
- **Secondary windows:** open via UI (Settings gear, menu, sidebar control), then `list_windows` and switch `WID` to the new window.
- **Nested UI (Settings tree, integration list → detail):** snapshot the **active** window, click the row/section, wait, re-snapshot before the next action.
- **Menus:** prefer opening the real menu and capturing only if docs need it; menu AX can be flaky—verify with a post-action snapshot.
- **Chat sample:** prefer an existing demo session in `~/.toby-generic` (e.g.
  “Morning briefing”). Only send a new prompt if needed; keep content non-sensitive.

If a click does nothing, re-snapshot and confirm the tree changed. Do not reuse
indices across snapshots.

---

## Step 5 — Capture

### Full-window (orientation shots)

```bash
cua-driver get_window_state \
  "{\"pid\":$PID,\"window_id\":$WID,\"capture_mode\":\"som\"}" \
  --screenshot-out-file "${RUN_DIR}/_raw-<name>.png"
```

Promote to final only when the whole window is the subject:

```bash
cp "${RUN_DIR}/_raw-<name>.png" "${RUN_DIR}/toby-app-<name>.png"
```

### Region crop (default for nested / how-to subjects)

1. Capture full window PNG + structured elements (`som` + `screenshot_out_file`).
2. Choose a crop box:
   - **AX union:** union `frame` rects of the controls/panes the doc is about; add ~24–40 px padding; clamp to image bounds.
   - **Visual:** read the PNG and set `WxH+X+Y` from what you see (use when frames are missing or misaligned).
   - **Split-view heuristic:** crop to detail pane (and selected nav row) rather than empty chrome.
3. Crop with ImageMagick:

```bash
magick "${RUN_DIR}/_raw-<name>.png" -crop "${W}x${H}+${X}+${Y}" +repage \
  "${RUN_DIR}/toby-app-<name>.png"
```

Helper for union boxes already in **screenshot pixels**:

```bash
crop_union() {
  # crop_union RAW.png OUT.png '[[x,y,w,h],...]' [pad]
  python3 -c '
import json, subprocess, sys
raw, out, boxes_json = sys.argv[1], sys.argv[2], sys.argv[3]
pad = int(sys.argv[4]) if len(sys.argv) > 4 else 32
boxes = json.loads(boxes_json)
xs, ys = [b[0] for b in boxes], [b[1] for b in boxes]
x2s, y2s = [b[0]+b[2] for b in boxes], [b[1]+b[3] for b in boxes]
iw, ih = map(int, subprocess.check_output(
    ["magick", "identify", "-format", "%w %h", raw], text=True).split())
x1, y1 = max(0, min(xs)-pad), max(0, min(ys)-pad)
x2, y2 = min(iw, max(x2s)+pad), min(ih, max(y2s)+pad)
w, h = max(1, x2-x1), max(1, y2-y1)
subprocess.check_call(["magick", raw, "-crop", f"{w}x{h}+{x1}+{y1}", "+repage", out])
print(f"cropped {w}x{h}+{x1}+{y1} -> {out}")
' "$@"
}
```

### Coordinates

- Screenshot space is **window-local pixels**, top-left origin, y-down. Long edge is often capped (~1568 px).
- Use `screenshot_width` / `screenshot_height` / `screenshot_scale_factor` from `get_window_state` when converting from point-sized frames.
- Element `frame` may be screen or window points depending on driver version—if a crop is wrong, set the box from the PNG visually.
- Prefer final PNG long edge roughly **900–1600 px** (readable labels, reasonable file size).

---

## Step 6 — Quality gate

For each final file:

- [ ] Subject is obvious without hunting
- [ ] Crop matches intent (not an accidental full-window when a form was needed)
- [ ] Correct surface / subsection (e.g. OpenAI form, not a generic Settings shell)
- [ ] No API keys, tokens, private mail, or personal data
- [ ] Content is from **`~/.toby-generic`** (demo names / sample chats), not the real home
- [ ] No agent cursor, debug crosshairs, or selection junk
- [ ] Related shots in one refresh share the same appearance mode when possible

---

## Step 7 — Publish and wire docs

```bash
IMG_DIR="apps/help-site/static/img"
for f in "${RUN_DIR}"/toby-app-*.png; do
  cp "$f" "${IMG_DIR}/$(basename "$f")"
done
```

Update help-site markdown only where images are used or new ones are needed:

```markdown
![Toby.app <short subject>](/img/toby-app-<filename>.png)
```

Find call sites with `rg -n 'toby-app-.*\.png' apps/help-site/docs/`. Do not
maintain a permanent “every page ↔ every PNG” table inside this skill—discover
references from the repo.

Optional build check:

```bash
cd apps/help-site && bun run build
```

---

## Step 8 — Clean up

```bash
cua-driver end_session "{\"session\":\"$SESSION\"}"
# optional: rm -rf "$RUN_DIR"
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No cached AX state` | Call `get_window_state` on the same `pid` + `window_id` before click |
| Click does nothing | Re-snapshot; wrong window_id or stale index; verify label/role filter |
| Empty / tiny screenshot | Window off-space or minimized; check `list_windows` (`is_on_screen`, bounds) |
| Crop misaligned | Frames not in screenshot pixels; crop visually from PNG |
| Wrong app chrome | Dev vs release title; confirm bundle id `dev.karim.toby.app.dev` |
| Overlay in image | `set_agent_cursor_enabled` false for the session before capture |
| Daemon/permissions | `cua-driver doctor` / `permissions status` |
| Personal data in UI | App launched without `TOBY_DIR`; re-run `bun run app:screenshots -- --reseed` |
| Empty / wrong integrations | `bun run app:screenshots -- --reseed` (copies connection flags from real config) |

---

## What this skill is not

- Not a permanent list of help-site pages or screenshot filenames (discover with `rg` / `ls`).
- Not a substitute for the **cua-driver** skill’s full automation contract.
- Not a requirement to re-shoot every surface on every docs tweak—scope via git + the shot list for the change at hand.
- Not permission to screenshot against `~/.toby` — **always** use `~/.toby-generic` (Step 3).
