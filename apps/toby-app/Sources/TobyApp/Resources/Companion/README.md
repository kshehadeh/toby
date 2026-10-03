# Companion animation artwork

`base-face.png` is the transparent, eye-free base portrait. Created from
`../toby-128.png` with the built-in image generation tool on 2026-10-03.
The original portrait remains unchanged. Native eye whites, outlines, and pupils
are drawn separately by `Features/Companion/CompanionEyes.swift`; their anchors
use the original 155 × 156 coordinate space. No directional animation frames
are required. Cursor movement changes only the pupil positions.

Generation prompt:

> Use case: precise-object-edit. Asset type: animation-ready base face layer for the existing Toby desktop companion. Edit target: the supplied Toby portrait. Preserve this exact character, its three-quarter pose, hair, eyebrows, nose, mouth, ear, suit, white interior, navy ink line style, proportions, silhouette, and framing. Change ONLY the eyes: remove the tiny existing pupil/eye ink strokes under the two eyebrows and replace those strokes with the same flat white face fill. Leave eyebrows intact. The eye areas must be blank so native moving eyes can be overlaid. Keep every other line as close to the reference as possible; do not redesign, enlarge the eyes, make a cartoon, or add shading. Remove the rounded square white icon plate outside the character; make the area outside the head, neck, and shoulders actually transparent. Keep the character in the same proportional position within the square canvas as the reference, without zooming, centering differently, or trimming the canvas. No text, labels, eye variants, detached parts, drop shadow, checkerboard pattern, or background.
