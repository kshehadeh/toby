# Listen recording fixtures

Sample dual-source recordings used by `scripts/seed-toby-generic-home.ts`
when building a demo Toby home.

**Archive:** [`listen-recordings.zip`](./listen-recordings.zip) (~46 MB compressed)

Tracked with **Git LFS** (see repo root `.gitattributes`: `scripts/fixtures/**/*.zip`).
Clones store a small pointer in git history; the real blob lives in LFS storage.
Requires `git lfs install` once per machine after clone.

The zip is used instead of loose multi‑MB WAV/M4A files. The seeder runs
`unzip` into `<home>/listen/recordings/`.

Each entry inside the zip is a complete recording folder (same layout as
`~/.toby/listen/recordings/<id>/`):

| File | Purpose |
| ---- | ------- |
| `combined.m4a` | Dual-mono stereo playback (L=mic, R=system) |
| `mic.wav` | Microphone track |
| `system.wav` | System audio track |
| `transcript.txt` / `transcript.json` | Plain + timed transcript |
| `metadata.json` | Recording metadata (`files.*` use **relative** basenames) |

## Updating fixtures

1. Capture or transcribe recordings in a Toby home (e.g. a demo directory).
2. Copy each recording directory into a staging folder.
3. Ensure `metadata.json` uses relative basenames for `files` (the seeder also
   rewrites absolute paths on extract).
4. Rebuild the zip:

```bash
src=~/Documents/toby-demo/listen/recordings
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

for id in "$src"/*/; do
  name=$(basename "$id")
  mkdir -p "$stage/$name"
  cp -p "$id"/{combined.m4a,mic.wav,system.wav,transcript.txt,transcript.json,metadata.json} \
    "$stage/$name/" 2>/dev/null || true
done

repo_root=$(git rev-parse --show-toplevel)
(cd "$stage" && zip -r -9 "$repo_root/scripts/fixtures/listen-recordings.zip" .)
```

Requires `unzip` on the machine that runs the seeder (available by default on macOS).
