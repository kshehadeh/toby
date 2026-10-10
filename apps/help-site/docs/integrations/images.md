---
sidebar_position: 13
title: Images
---

# Images

Images lets Toby crop, resize, rotate, adjust colours, convert, and compress your
images locally. It ships with Toby and needs no account or API key.

## Connect

Open **Settings → Integrations → Images** and click **Connect**. Toby checks the
local image engine. You can also run `toby connect images` from the CLI.

## Edit an image

Attach an image in chat and describe the changes you want. You can also provide
an absolute local file path, or refer to an image inside the active project.

Examples:

- “Crop this image square, make it a little less saturated, and save it as WebP.”
- “Resize this photo to fit within 1200 by 800 pixels.”
- “Convert this PNG to JPEG with a white background and quality 85.”
- “Convert the PNGs in Downloads to JPEG with the same names in the same folder.”
- “Try to make this image smaller than 300 KB without resizing it.”
- “Rotate `attachments/photo.jpg` clockwise and save it in this project.”

Toby saves a new file and includes **Download** and **Open** buttons. In a project,
results go to its outputs folder. Other results go to Toby's generated-files
folder by default. Ask for **the same folder** to save beside a local source,
keeping its name with the new extension. Attached images use the default output
folder because they have no local source folder. Your original stays unchanged,
and existing files are never overwritten. Use **Open** to view a result, or
right-click its file card and choose **Reveal in Finder** to find it.
Files remain available after reopening the chat until you move or delete them.

## Supported edits

- Pixel-rectangle or centred aspect-ratio cropping.
- Resizing with contain or cover fit; enlargement is off by default.
- Rotation in 90-degree steps and horizontal/vertical flips.
- Saturation, brightness, contrast, and grayscale.
- Conversion between still JPEG, PNG, and WebP.
- JPEG/WebP quality settings and lossless PNG/WebP options.

JPEG cannot preserve transparency, so conversion uses a white background unless
you ask for another colour. Images are oriented correctly, converted to sRGB,
and saved without descriptive metadata such as GPS information.

Quality settings control compression; increasing quality cannot recover detail
already lost. PNG compression changes file size without reducing visual quality. Toby applies
encoding settings for the selected output format, so unused PNG compression
settings do not block a JPEG conversion.
When a requested size cannot be met within the quality limit, Toby reports that
and provides the smallest result it tried. It does not silently shrink dimensions.

## Limits

Images supports still JPEG, PNG, and WebP files. Animated images, HEIC, RAW, SVG,
PDF, and images at web URLs are not supported. Chat attachments are limited to
20 MiB each; local files to 50 MiB and 40 megapixels.

Local image tools can work with text-only chat models. Those models can follow
your editing instructions but cannot visually inspect the image. Describe the
desired crop or use centred cropping when the subject position matters.

Disconnecting Images disables its tools and keeps saved files.
