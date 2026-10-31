# Wilderness Almanac branding

## Active antler mark

`wilderness-antler-mark.svg` recreates the supplied antlered-creature JPG using
rectilinear vector paths. It preserves the reference's proportions and 1280 ×
1280 canvas, with a transparent background and open face. Small raster edge
deviations are straightened. The SVG uses `currentColor` when inlined and contains no embedded
bitmap.

The campaign-menu heading uses this mark through its `antler-mark` path ID, with
the artwork cropped to `viewBox="212 206 856 906"`. Desktop supplies the frame in
CSS; mobile shows the unframed mark.

The boxed favicon is generated from this same path in the default menu's gold
on dark background. Regenerate its SVG, ICO, PNG, Apple and manifest icon assets
with `python3 tools/render-brand-icons.py` (requires `rsvg-convert` and Pillow).
The border and padding match the desktop proportions. `public/site.webmanifest`
references the generated 192px and 512px icons.

The artwork is covered by the application [AGPLv3 license](../../LICENSE). Font and icon licenses are documented separately in their asset directories.
