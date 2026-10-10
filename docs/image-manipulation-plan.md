# Image manipulation integration plan

Status: implemented; see [image-manipulation.md](image-manipulation.md) for the
shipped contract and current limits. The proposal below records the original plan.

## Goal and architecture

Let users ask Toby to crop, resize, adjust colours, convert, and compress existing
images. Processing runs locally without an image-generation model or service.

Confirmed interpretation of “built in”: ship a first-party **Images** integration
as `apps/plugin-images/`, installed and upgraded with Toby. Use manifest name
`images`, package `@toby/plugin-images`, and distribution directory
`toby-plugin-images`. This follows the current integration architecture; discovery
registers it without adding a `BUILTIN_MODULES` entry.

Use a TypeScript bun-package plugin with **Sharp** as the proposed processing engine.
Sharp documents Bun installation, prebuilt macOS ARM64/x64 binaries, colour adjustment,
and output encoding options. Validate the actual bundled Bun runtime and clean release
installation before committing to the engine:

- [Installation and platform support](https://sharp.pixelplumbing.com/install/)
- [Encoding, quality, and metadata](https://sharp.pixelplumbing.com/api-output/)
- [Colour adjustments](https://sharp.pixelplumbing.com/api-colour/)

The plugin owns processing and tool schemas. Core owns attachment resolution,
session/project scope, and any chat-accessible output delivery. Native app changes
are needed only if existing file presentation cannot show/open the result.

## Initial tool set

| Proposed tool | Purpose | Main parameters |
| --- | --- | --- |
| `imagesInspect` | Read dimensions, format, size, alpha, orientation, and frame/page count | Source reference |
| `imagesTransform` | Apply several edits and encode once | Source, destination, crop, resize, rotate, flip, adjustments, format, encoder options |
| `imagesConvert` | Simple format conversion | Source, destination, format, quality, transparency background |
| `imagesCompress` | Re-encode at specified quality or search for a byte-size target | Source, destination, format, quality or target bytes, minimum quality |

Dedicated conversion/compression tools make common requests straightforward. They
share validation and encoding code with `imagesTransform`. Avoid exposing every
adjustment as a separate tool requiring another intermediate file and lossy encode.

Initial transforms:

- Crop by integer pixel rectangle; optionally centre-crop to an aspect ratio.
- Resize by width/height, with contain/cover fit and no enlargement by default.
- Rotate in 90-degree increments; horizontal/vertical flip.
- Saturation and brightness multipliers (`1` unchanged, saturation `0` grayscale).
- Explicit grayscale; contrast through a documented bounded adjustment.
- Encode JPEG, PNG, or WebP. Expose JPEG/WebP quality and lossless WebP explicitly;
  PNG compression level is separate from visual quality.

Initially accept still JPEG, PNG, and WebP. Reject multi-frame/multi-page images
explicitly rather than silently dropping content. Defer HEIC/HEIF, RAW, SVG/PDF,
animation, arbitrary-angle rotation, batch processing, background removal, and
generative editing. Expand formats after codec and packaging verification.

## Processing semantics

Define one predictable order: orient from EXIF, rotate/flip, crop, resize, adjust
colours, flatten alpha if necessary, then encode. Crop coordinates and inspection
dimensions refer to the oriented/rotated image; report stored dimensions separately.
Tool descriptions must state this order. Do not assume chaining Sharp methods
automatically enforces it; verify with asymmetric fixtures and stage processing
where required.

- Require positive dimensions and in-bounds crop rectangles. Validate all numeric
  parameters and enforce image/input/output limits before expensive work.
- Convert to sRGB by default and strip descriptive metadata, including GPS. Preserve
  the intended appearance through colour conversion; metadata preservation can be
  a later explicit option.
- Keep alpha for PNG/WebP. JPEG conversion with alpha uses an explicit background
  or a documented white default, recorded in the result.
- Defaults proposed: JPEG/WebP quality 85; resize without enlargement; no overwrite.
- Quality changes cannot restore detail already lost through compression. Describe
  them as encoding quality rather than image enhancement.
- Byte-target compression uses bounded attempts and a minimum quality. Report
  `targetMet: false` and achieved size when impossible. Do not silently reduce
  dimensions to meet a byte target. Reject combinations with lossless formats in
  the first version unless a meaningful compression strategy is implemented.

## Input, output, and chat integration

Support local files and chat attachments. Use source references, never image bytes
inside model-generated tool arguments. Existing chat attachments contain base64
data; they are not automatically exposed as filesystem paths to plugins.

1. Audit/reuse the existing attachment and project file APIs. Add a small core-owned
   materialization/resolution bridge only where needed. Assign opaque references
   to attached images and expose those references in the turn context.
2. Resolve and authorize sources in core, then pass only approved paths or scoped
   references to the plugin. A filename alone is not a reliable identity.
3. Reuse the existing tool-request `paths.dataDir` plumbing for plugin-owned outputs
   when appropriate. The plugin must not discover Toby's private directories or
   credentials itself. Core uses the config path helpers and handles project/session
   destinations; extend the envelope additively if additional scoped paths are needed.
4. Write a new output by default. In project chats, honor the project's output
   boundary. For local files, prefer a clearly named sibling copy when authorized;
   otherwise use managed output storage. Return the actual destination.
5. Reject existing destinations and source/output identity in v1. Write through a
   temporary file with cleanup and atomic, no-clobber publication. Handle symlinks
   and path containment using filesystem identity, not string-prefix checks.
6. Return source/output references, filename, format/MIME, dimensions, byte size,
   compression ratio, applied edits, and warnings. Never return full image base64
   to the model.
7. Verify how chat can present results. Reuse existing open/download/preview support
   where possible; otherwise add a scoped file route backed by registered output
   references. Never expose an arbitrary absolute-path HTTP reader. Local paths
   alone are insufficient for a complete attached-image workflow.
8. Specify managed output lifetime and cleanup. Persist references with the session
   if results must reopen later; use existing retention mechanisms where available.

Local processing should work without requiring the selected language model to
understand images. Audit attachment capability gating and change only what is
needed to permit tool processing; model-specific vision remains separately gated.

## Integration lifecycle and limits

- No API keys or external account. Connect validates the processing engine and
  enables the integration; disconnect disables its tools without deleting outputs.
  Propose default enablement on new installs; verify existing connection semantics
  and make any first-party auto-enable behavior deliberate.
- Implement protocol v1 status, connect/disconnect, config shape/get/set, tools
  list/execute, and required `chatModelPrep`. Status remains available with a clear
  engine-unavailable diagnostic when the native dependency cannot load.
- Inspection is read-only; writing tools are mutating. Honor `dryRun`: validate and
  describe planned edits/destination without writing files. Return `appliedActions`
  for completed writes, matching repository conventions for dry-run descriptions.
- Start with a proposed 50 MB input and 40 megapixel decoded-image limit, bounded
  compression attempts, and work completing within the existing 120-second plugin
  timeout. Confirm final limits against attachment limits and measured memory/runtime.
- Reject remote URLs in v1. Use structured errors for unsupported format, invalid
  crop, input too large, permission denied, destination exists, and processing failure.
- Ensure failure/timeout cleanup covers temporary files; verify whether native work
  needs additional deadlines rather than relying only on subprocess termination.

## Implementation sequence

1. **Engine and distribution spike.** Test Sharp under the bundled Bun, both supported
   macOS architectures, and a standalone copied plugin. Verify optional native
   dependencies, dependency pinning/lockfile behavior, signing/notarization, and
   release/upgrade installation. Follow the current `copy-bun-plugin-to-dist.sh`,
   which rebuilds production dependencies after removing workspace symlinks; older
   skill examples about distribution contents are not the source of truth.
2. **Plugin and processing engine.** Scaffold protocol handlers; implement inspection,
   validation, safe output writing, and the shared transform/encode pipeline.
3. **Tools.** Add transform, conversion, and bounded compression; document schemas,
   defaults, operation order, and result/error shapes. Exercise calls through the
   real plugin adapter, including its JSON Schema conversion.
4. **Files and chat.** Complete attachment resolution, project boundaries, output
   delivery, persistence, and lifecycle. Validate both explicit local-path requests
   and “crop the image I attached” end to end.
5. **Ship wiring.** Add root build scripts and all current release artifact,
   installer, upgrade, and validation lists. Confirm discovery/doctor and Images
   visibility in the app. Apply design/native-window skills before visible UI work.
6. **Docs and validation.** Publish technical `docs/image-manipulation.md` and user
   `apps/help-site/docs/integrations/images.md`; update integration/API/index coverage
   as applicable. Keep this proposal separate from documentation of shipped behavior.

## Acceptance checks

Use Bun tests with temporary directories and small deterministic fixtures:

- Correct crop pixels, output dimensions, and rotate/flip order on asymmetric images.
- Saturation zero produces grayscale; unchanged settings preserve expected colours
  within encoder tolerance; EXIF orientation and colour profiles behave as specified.
- JPEG/PNG/WebP conversion, alpha handling, and metadata stripping.
- Compression quality bounds and target-met/unattainable results, without asserting
  exact encoder-dependent output bytes.
- Original unchanged; no overwrite; invalid crops, corrupt files, oversized images,
  animation, symlink escapes, failures, and dry-run leave no unintended output.
- Protocol contract, tool schemas through the adapter, enable/disable, discovery,
  missing engine diagnostics, and clean packaged-install/upgrade smoke tests.
- Attached image and project image workflows produce accessible outputs, including
  later session reopening if supported; source references cannot cross session scope.

Run `bun run lint`, `bun run typecheck`, and `bun run test` after implementation;
run Swift tests/build checks if native app code changes. This planning-only change
does not implement tools or change runtime behavior.

## Example outcome

“Crop this image square, make it slightly less saturated, and save a WebP under
300 KB” resolves the attachment, inspects dimensions, chooses the stated centre
crop (or asks when subject positioning matters), and performs the edits followed
by bounded compression. Toby returns an accessible new image, dimensions, size,
and whether the target was met, preserving the source.
