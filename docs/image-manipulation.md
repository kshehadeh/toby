# Images integration

Images is a bundled first-party TypeScript bun-package plugin at
`apps/plugin-images/`, distributed as `toby-plugin-images`. It uses pinned Sharp
and libvips native dependencies under Bun. All image processing stays local;
there are no credentials or image-generation model requirements.

Connect with `toby connect images` or the integration's Connect button in Settings.
Connection probes the engine; disconnect disables chat availability and preserves
outputs. It follows the existing opt-in connection lifecycle rather than enabling
itself automatically. Native dependency failures remain visible through status.

## Tools

| Tool | Behavior |
| --- | --- |
| `imagesInspect` | Read oriented/stored dimensions, format, orientation, alpha, byte size, and page count. |
| `imagesTransform` | Orient, rotate, flip, crop, resize, adjust colours, and encode. Combine edits in one call. Supports bounded target-size compression. |
| `imagesConvert` | Convert to JPEG, PNG, or WebP with optional encoder settings. |
| `imagesCompress` | Re-encode at a quality or search for a byte target without resizing. |

All tools require `source`: `attachment:<exact current-turn filename>`, a
project-relative path in project chat, or an absolute local path outside project
chat. URLs are rejected. `outputName` is an optional basename with the matching
format extension. `outputLocation` defaults to `default` (project `outputs/`
or `getGeneratedFilesDir()` outside projects). Set it to `source` to save beside
a local input, using the source basename with the new extension unless
`outputName` is supplied. Attachments have no source folder and reject `source`
output location. Project chats still require the source and destination inside
the active project. Default output location uses a unique edited filename.
Local JPEG, PNG, and WebP links use the native file controls, including Open,
Download, and Reveal in Finder. Destinations
cannot be overwritten; original bytes stay unchanged.

Supported input/output: still JPEG, PNG, and WebP. Animation, multiple pages,
HEIC/RAW, SVG/PDF, and remote fetches are unsupported. Inputs and encoded outputs
are limited to 50 MiB; decoded/requested dimensions to 40 megapixels. Chat
attachments retain the existing 20 MiB per-file, 50 MiB total limits.

Transform parameters:

- `rotate`: 0, 90, 180, or 270 clockwise; `flipHorizontal`, `flipVertical`.
- `crop`: integer `left`, `top`, `width`, `height` after EXIF orientation, rotation,
  and flips. Alternatively `aspectRatio` centre-crops width/height; these are exclusive.
- `width`, `height`, `fit`: contain (default) or cover. `enlarge` defaults false.
- `saturation`, `brightness`, `contrast`: multipliers from 0 to 3, default 1;
  saturation 0 is grayscale. Contrast is linear about midpoint 128. `grayscale`
  is also available explicitly.
- `format`: jpeg/png/webp, default input format; JPEG/WebP `quality` 1–100,
  default 85. PNG instead uses lossless `compressionLevel` 0–9, default 6.
  Encoder settings for another output format are ignored (`compressionLevel`
  for JPEG/WebP, `quality` for PNG). Optional tool fields accept null as omitted.
- `lossless`: WebP only, incompatible with quality/target bytes.
- `background`: opaque `#RRGGBB`, white default, for JPEG alpha flattening and
  contain padding. PNG/WebP retain alpha.
- `targetBytes`, `minQuality`: JPEG/WebP bounded quality search (at most nine
  encodes), default quality floor 30. The ceiling is `quality`. An unattainable
  target returns a file at the floor with `targetMet: false`; dimensions are
  never silently reduced. `minQuality` requires `targetBytes`.

The engine converts to sRGB and strips descriptive metadata, including GPS.
Raw intermediate stages make operation order explicit without extra lossy
encoding. Quality controls future encoding loss; it cannot recover lost detail.
Each native stage/encode has a deadline, within the plugin subprocess timeout.

## File context and delivery

The optional protocol-v1 `fileAccess: true` tool annotation requests core's file
bridge. The adapter resolves `source` at execution time and sends `files.source`
(approved local path or attachment base64 plus filename) and `files.outputDir`.
Image bytes never appear in model-generated arguments or tool results.

`bindPluginFileContext` binds cached tool executors to each turn using async local
storage. References resolve only against that turn's attachments; ambiguous
filenames fail. Read-only file results bypass the cross-turn tool-result cache,
because a reference can resolve to different bytes each turn. Project source realpaths must stay inside the project, and
project output directories cannot traverse symlinks. The plugin writes to the
core-supplied destination without discovering private Toby paths itself.

`dryRun` validates source, parameters, crop, limits, and destination, returning
planned edits without writing files or creating an output directory. Real writes
use temporary files and atomic hard-link publication with no clobber. Temporary
files are removed on normal success/failure; external process termination may
leave a `.images-*.tmp` file.

Results include dimensions, format/MIME, bytes, applied settings, compression
ratio, optional achieved quality/target status, warnings, `path`, `fileUrl`, and a
Markdown Download link. Chat uses the existing native Download/Open rendering.
Outputs remain on disk like other generated/project files; the reply link is
persisted with the transcript and remains usable after reopening while the file
exists. Attachment references themselves are current-turn only. There is no new
public file HTTP endpoint or automatic retention policy.

`resolveChatInputCapability` permits supported images to local tools when Images
is connected even on a text-only model. Native model FileParts remain governed
by `resolveChatAttachmentCapability`; this does not enable vision for those models.

## Build and verification

`bun run build:plugin:images` rebuilds production dependencies in the distribution
directory, removing workspace symlinks. Release builds bundle the plugin;
installer discovery is generic and staged upgrades explicitly install it. Release
signing signs Sharp's `.node`/`.dylib` modules inside app resources. Bundled Bun
permits installed native libraries through its separate runtime entitlement.

Tests cover pixel order, crop/resize, grayscale, EXIF orientation, alpha,
compression, no overwrite, dry-run, bad inputs, protocol lifecycle, adapter schema
execution, attachment isolation, project boundaries, and model capability gating.
Run `bun run lint`, `bun run typecheck`, and `bun run test`.
