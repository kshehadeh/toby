# Toby Images plugin

Bundled local image tools: inspect, crop/resize/rotate/flip, colour adjustments,
JPEG/PNG/WebP conversion, and bounded compression. TypeScript bun-package,
protocol v1; Sharp/libvips under Bun. No credentials. Connect to enable.

Build: `bun run build:plugin:images` from the repository root.
Tests: `bun run --cwd apps/plugin-images test`.

See [technical documentation](../../docs/image-manipulation.md) for tool schemas,
file context, processing semantics, limits, and release packaging.
