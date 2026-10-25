"""Render the boxed antler mark with librsvg and Pillow.

Run with: python3 tools/render-brand-icons.py
"""

from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

from PIL import Image


PUBLIC = Path(__file__).resolve().parent.parent / "public"
source = ET.parse(PUBLIC / "brand/wilderness-antler-mark.svg")
mark = source.find("{http://www.w3.org/2000/svg}path").attrib["d"]

# Match the menu: box = 1.4em, i-stem border = .076em, padding = .038em.
# Favicons use the default menu's gold on its dark page background.
svg = f'''<svg
  xmlns="http://www.w3.org/2000/svg"
  width="512"
  height="512"
  viewBox="0 0 1400 1400"
  shape-rendering="crispEdges"
>
  <title>The Wilderness Almanac</title>
  <path fill="#171321" d="M0 0H1400V1400H0Z" />
  <g fill="#e5b96e">
    <path fill-rule="evenodd" d="M0 0H1400V1400H0ZM76 76V1324H1324V76Z" />
    <svg x="114" y="114" width="1172" height="1172" viewBox="212 206 856 906" overflow="visible">
      <path
        fill-rule="evenodd"
        d="{mark}"
      />
    </svg>
  </g>
</svg>
'''
(PUBLIC / "favicon.svg").write_text(svg)

exports = {
    16: "favicon-16.png",
    32: "favicon-32.png",
    48: "favicon-48.png",
    96: "favicon-96.png",
    180: "apple-touch-icon.png",
    192: "icon-192.png",
    512: "icon-512.png",
}
for size, name in exports.items():
    subprocess.run(
        [
            "rsvg-convert",
            "-w", str(size),
            "-h", str(size),
            str(PUBLIC / "favicon.svg"),
            "-o", str(PUBLIC / name),
        ],
        check=True,
    )

# Render each ICO frame at its own size; keep hard pixel edges at every scale.
ico_sizes = [16, 32, 48, 64, 128, 256]
with tempfile.TemporaryDirectory(prefix="wilderness-favicons-") as directory:
    frames = []
    for size in ico_sizes:
        frame_path = Path(directory) / f"{size}.png"
        subprocess.run(
            [
                "rsvg-convert",
                "-w", str(size),
                "-h", str(size),
                str(PUBLIC / "favicon.svg"),
                "-o", str(frame_path),
            ],
            check=True,
        )
        with Image.open(frame_path) as frame:
            frames.append(frame.convert("RGBA"))
    frames[-1].save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(size, size) for size in ico_sizes],
        append_images=frames[:-1],
    )

print(
    "Rendered SVG, ICO (16/32/48/64/128/256), PNG (16/32/48/96), "
    "Apple (180), and manifest icons (192/512)."
)
