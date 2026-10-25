# Wilderness creature marks

## Traced antler mark

`wilderness-antler-mark.svg` recreates the supplied antlered-creature JPG using
rectilinear vector paths. It preserves the reference's proportions and 1280 ×
1280 canvas, with a transparent background and open face. Small raster edge
deviations are straightened; the artwork is not forced onto the earlier concepts'
24 × 24 grid. The SVG uses `currentColor` when inlined and contains no embedded
bitmap.

The campaign-menu heading uses this mark through its `antler-mark` path ID, with
the artwork cropped to `viewBox="212 206 856 906"`. Desktop supplies the frame in
CSS; mobile shows the unframed mark.

The boxed favicon is generated from this same path in the default menu's gold
on dark background. Regenerate its SVG, ICO, PNG, Apple and manifest icon assets
with `python3 tools/render-brand-icons.py` (requires `rsvg-convert` and Pillow).
The border and padding match the desktop proportions. `public/site.webmanifest`
references the generated 192px and 512px icons.

## Outline concept

`wilderness-creature-outline.svg` is an original outline creature inspired by
the pixel-grid style of the supplied dragon reference. Swept horns, square eyes,
a short muzzle mark and a stepped jaw surround a transparent face. It contains
no letters or monogram. Its geometry is drawn for this project, rather than
copied from the reference.

The mark uses a 24 × 24 viewBox, two-unit pixels and `currentColor` when inlined.
`wilderness-creature-outline.png` is the transparent 384 × 384 gold export
(`#e5b96e`). These are standalone logo concepts, not yet wired into the app.

## Filled concept

An original pixel monster logo concept for Wilderness Almanac. The mark uses a
24 × 24 viewBox, a two-unit pixel grid, stepped horns, square eyes and a toothy
grin. It contains no letters or monogram.

`wilderness-monster.svg` uses `currentColor` when inlined. Render at 24, 48, 72 or
96 CSS pixels for whole-pixel edges. `wilderness-monster.png` is a transparent
384 × 384 export in the menu's gold (`#e5b96e`).

This is a standalone concept, not yet wired into the application. The geometry
was drawn for this project; the bundled Pixelarticons sprite and its MIT notice
remain separate. This mark is covered by the application license in
[`LICENSE`](../../LICENSE).

## Exporting

Render either SVG at 24, 48, 72 or 96 CSS pixels for whole-pixel edges. To
regenerate the outline PNG with librsvg:

```sh
printf 'svg { color: #e5b96e; }\n' > /tmp/wilderness-creature-gold.css
rsvg-convert --stylesheet /tmp/wilderness-creature-gold.css -w 384 -h 384 \
  public/brand/wilderness-creature-outline.svg -o public/brand/wilderness-creature-outline.png
```

Use the filled concept's filenames to regenerate its PNG with the same settings.
