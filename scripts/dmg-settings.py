"""Finder layout for dmgbuild; coordinates are in points, from the top left."""

from pathlib import Path

root = Path(defines["root"])
app = root / "dist" / "Toby.app"

format = "UDZO"
filesystem = "HFS+"
files = [str(app)]
symlinks = {"Applications": "/Applications"}
icon = str(app / "Contents" / "Resources" / "AppIcon.icns")
background = str(root / "images" / "dmg-background.png")

window_rect = ((160, 160), (800, 460))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
include_icon_view_settings = True
include_list_view_settings = False
arrange_by = None
icon_size = 96
text_size = 13
label_pos = "bottom"
hide_extensions = ["Toby.app"]
icon_locations = {
    "Toby.app": (110, 250),
    "Applications": (330, 250),
}
