"""Packaging checks; optionally verify the final, mounted DMG as well.

Run with dist/.dmg-tools/bin/python scripts/test-packaging.py --volume <mount>.
"""

import argparse
import hashlib
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
VOLUME = None


def png_header(path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"Not a PNG: {path}"
    return struct.unpack(">IIBB", data[16:26])


class PackagingTests(unittest.TestCase):
    def test_icon_is_full_resolution_with_transparency(self):
        width, height, depth, color_type = png_header(ROOT / "images/app-icon.png")
        self.assertEqual((width, height), (1024, 1024))
        self.assertEqual(depth, 8)
        self.assertEqual(color_type, 6)  # RGBA, not a flattened RGB plate.

    def test_background_has_matching_retina_version(self):
        for name, dimensions in [
            ("dmg-background.png", (800, 400)),
            ("dmg-background@2x.png", (1600, 800)),
        ]:
            self.assertEqual(png_header(ROOT / "images" / name)[:2], dimensions)

    def test_silhouette_fills_icon_and_has_white_outline(self):
        subprocess.run(["swift", str(ROOT / "scripts/test-icon-artwork.swift")], check=True)

    def test_icns_contains_every_standard_resolution(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "dist") as directory:
            output = Path(directory) / "AppIcon.icns"
            iconset = Path(directory) / "AppIcon.iconset"
            subprocess.run(
                ["bash", str(ROOT / "scripts/build-app-icon.sh"), str(output)],
                check=True,
            )
            subprocess.run(
                ["iconutil", "-c", "iconset", str(output), "-o", str(iconset)],
                check=True,
            )
            expected = set()
            for size in [16, 32, 128, 256, 512]:
                for suffix, pixels in [("", size), ("@2x", size * 2)]:
                    name = f"icon_{size}x{size}{suffix}.png"
                    expected.add(name)
                    self.assertEqual(png_header(iconset / name)[:2], (pixels, pixels))
            self.assertEqual({p.name for p in iconset.iterdir()}, expected)

    def test_mounted_dmg_layout_and_background(self):
        if VOLUME is None:
            self.skipTest("Pass --volume to verify the final mounted DMG.")
        from ds_store import DSStore
        from mac_alias import Alias

        with DSStore.open(str(VOLUME / ".DS_Store"), "r") as store:
            self.assertEqual(store["Toby.app"]["Iloc"], (110, 250))
            self.assertEqual(store["Applications"]["Iloc"], (330, 250))
            self.assertEqual(store["."]["icvl"], (b"type", b"icnv"))
            window = store["."]["bwsp"]
            self.assertEqual(window["WindowBounds"], "{{160, 160}, {800, 460}}")
            for key in ["ShowToolbar", "ShowSidebar", "ShowStatusBar", "ShowPathbar"]:
                self.assertFalse(window[key])
            view = store["."]["icvp"]
            self.assertEqual(view["iconSize"], 96)
            self.assertEqual(view["backgroundType"], 2)
            alias = Alias.from_bytes(view["backgroundImageAlias"])
            self.assertEqual(alias.target.filename, ".background.tiff")
        self.assertTrue((VOLUME / ".background.tiff").is_file())
        self.assertEqual((VOLUME / "Applications").readlink(), Path("/Applications"))
        self.assertEqual(
            {p.name for p in VOLUME.iterdir() if not p.name.startswith(".")},
            {"Toby.app", "Applications"},
        )

    def test_mounted_dmg_preserves_the_built_app_icon(self):
        if VOLUME is None:
            self.skipTest("Pass --volume to verify the final mounted DMG.")
        original = ROOT / "dist/Toby.app/Contents/Resources/AppIcon.icns"
        digest = hashlib.sha256(original.read_bytes()).digest()
        for path in [
            VOLUME / "Toby.app/Contents/Resources/AppIcon.icns",
            VOLUME / ".VolumeIcon.icns",
        ]:
            self.assertEqual(hashlib.sha256(path.read_bytes()).digest(), digest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--volume", type=Path)
    args, remaining = parser.parse_known_args()
    VOLUME = args.volume
    unittest.main(argv=[__file__, *remaining])
