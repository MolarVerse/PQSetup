"""PQSetup terminal identity backed by the shared PQDesign assets."""

import json
from importlib.resources import files

from . import __version__
from ._design_terminal import Terminal


_colors = json.loads(
    files("pqsetup").joinpath("design/tokens.json").read_text(encoding="utf-8")
)["color"]
terminal = Terminal("PQSetup", __version__, _colors)
