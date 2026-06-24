---
name: toby-screenshot-docs
description: Refetch native macOS app screenshots for the help-site documentation. Use when the Toby.app UI has changed and you need to update the screenshots in apps/help-site/static/img/ and the references in docs/toby-app.md.
---

# Refetch Toby.app Screenshots

## Goal

Capture fresh screenshots of the Toby native macOS app windows and update the
help-site documentation images. Use this when the UI has changed and the docs
screenshots are stale.

## Prerequisites

1. **cua-driver** installed and on PATH:
   ```bash
   which cua-driver
   ```
   If missing: `curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh | bash`

2. **cua-driver daemon running**:
   ```bash
   cua-driver status
   ```
   If not running: `open -n -g -a CuaDriver --args serve`

3. **macOS permissions granted** (Accessibility + Screen Recording):
   ```bash
   cua-driver permissions status
   ```
   If not granted: `cua-driver permissions grant` (triggers system dialogs).

4. **Toby.app built** at `dist/Toby (Dev).app`:
   ```bash
   bun run build:app
   ```
   The dev variant uses bundle ID `dev.karim.toby.app.dev`.

## Window inventory

The Toby.app sidebar provides these windows, each with a corresponding
screenshot file in `apps/help-site/static/img/`:

| Sidebar item | Screenshot file | Doc section |
| --- | --- | --- |
| (main chat window) | `toby-app-main.png` | Chat |
| Recordings | `toby-app-recordings.png` | Recordings |
| Integrations | `toby-app-integrations.png` | Integrations |
| Skills | `toby-app-skills.png` | Skills |
| Schedules | `toby-app-schedules.png` | Schedules |
| Settings | `toby-app-settings.png` | Settings |

## Capture workflow

### 1. Set up run isolation

```bash
RUN_ID="$(date +%s)-$$"
RUN_DIR="$(mktemp -d /tmp/droid-run-${RUN_ID}-XXXXXX)"
SESSION="${RUN_ID}-toby"
```

### 2. Start a cua-driver session

```bash
cua-driver start_session "{\"session\":\"$SESSION\"}"
```

### 3. Launch the app

```bash
LAUNCH_OUTPUT=$(cua-driver launch_app '{"bundle_id":"dev.karim.toby.app.dev"}')
PID=$(echo "$LAUNCH_OUTPUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['pid'])")
```

Wait a few seconds for windows to initialize, then find the main window:

```bash
sleep 3
cua-driver list_windows "{\"pid\":$PID}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for w in data.get('windows', []):
    if w.get('title') == 'Toby (Dev)' and w.get('is_on_screen'):
        print(w['window_id'])
" 
```

### 4. Screenshot the main window

```bash
MAIN_WID=<main_window_id>
cua-driver get_window_state "{\"pid\":$PID,\"window_id\":$MAIN_WID,\"capture_mode\":\"som\"}" \
  --screenshot-out-file "${RUN_DIR}/main.png"
```

### 5. Navigate to each sidebar window

For each sidebar item (Integrations, Skills, Schedules, Recordings, Settings):

1. **Re-snapshot** the main window to get fresh element indices:
   ```bash
   cua-driver get_window_state "{\"pid\":$PID,\"window_id\":$MAIN_WID,\"capture_mode\":\"ax\"}" | \
     python3 -c "
   import json, sys
   data = json.load(sys.stdin)
   for el in data.get('elements', []):
       if el.get('label','').lower().strip() == '<window_name>' and 'menu' not in el.get('role','').lower():
           print(el['element_index'])
           break
   "
   ```

2. **Click** the sidebar item:
   ```bash
   cua-driver click "{\"pid\":$PID,\"window_id\":$MAIN_WID,\"element_index\":<idx>,\"session\":\"$SESSION\"}"
   ```

3. **Wait** for the new window to open (`sleep 2`).

4. **Find** the new window by title:
   ```bash
   cua-driver list_windows "{\"pid\":$PID}" | python3 -c "
   import json, sys
   data = json.load(sys.stdin)
   for w in data.get('windows', []):
       if w.get('title') == '<Window Title>' and w.get('is_on_screen'):
           print(w['window_id'])
           break
   "
   ```

5. **Screenshot** the new window:
   ```bash
   cua-driver get_window_state "{\"pid\":$PID,\"window_id\":<new_wid>,\"capture_mode\":\"som\"}" \
     --screenshot-out-file "${RUN_DIR}/<name>.png"
   ```

### 6. Copy screenshots to the help-site

```bash
IMG_DIR="apps/help-site/static/img"
cp "${RUN_DIR}/main.png"         "${IMG_DIR}/toby-app-main.png"
cp "${RUN_DIR}/recordings.png"   "${IMG_DIR}/toby-app-recordings.png"
cp "${RUN_DIR}/integrations.png" "${IMG_DIR}/toby-app-integrations.png"
cp "${RUN_DIR}/skills.png"       "${IMG_DIR}/toby-app-skills.png"
cp "${RUN_DIR}/schedules.png"    "${IMG_DIR}/toby-app-schedules.png"
cp "${RUN_DIR}/settings.png"     "${IMG_DIR}/toby-app-settings.png"
```

### 7. Update documentation (if needed)

The screenshot references live in `apps/help-site/docs/toby-app.md` under the
"Surfaces" section. Each subsection uses this pattern:

```markdown
### <Window Name>

<Description>

![Toby.app <Window Name> window](/img/toby-app-<filename>.png)
```

If a new window has been added to the app, add a new subsection following this
pattern and update the count in the intro line ("Toby.app provides N main
windows").

### 8. Verify the docs build

```bash
cd apps/help-site && bun run build
```

### 9. Clean up

```bash
cua-driver end_session "{\"session\":\"$SESSION\"}"
```

## Notes

- The app launches in the background (no foreground activation). Windows are
  hidden but fully addressable via cua-driver.
- Always re-snapshot the main window before clicking a sidebar item, because
  element indices are per-snapshot and stale indices fail.
- The `capture_mode: "som"` setting returns both the AX tree and a PNG
  screenshot in one call. Use `"ax"` for cheaper lookups when you only need
  element indices.
- Screenshots are per-window (not full display), so they capture only the
  target window even with other windows visible behind it.
- The help-site prebuild step (`cp ../../images/*.png static/img/`) copies
  project images into static/img/ but does not overwrite the `toby-app-*.png`
  files.
