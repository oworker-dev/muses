# Corporate Report Editable SVG Evidence

Generated from `/root/a.png` by the fixture-driven
`image.to-editable.v1` vertical slice.

## Outputs

- `editable.svg`: layered editable SVG
- `preview.png`: rasterized SVG preview
- `scene-manifest.json`: host-neutral scene and asset manifest
- `qa.json`: structural and pixel checks
- `assets/`: separate replaceable raster layers

## Editable Surface

- 154 native SVG text elements
- 113 native SVG vector shapes
- 3 bounded raster layers
- Full source image embedded: false

The skyline, waves, and brand mark remain raster layers because they are
complex low-edit-value visuals. All ordinary copy, KPI values, legends, donut
segments, roadmap cards, bars, line chart, and footer content are editable SVG.

Pixel similarity is 0.9037; this fixture prioritizes structural
editability and layout fidelity over pixel-identical tracing.
