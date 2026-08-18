# AI Image Capability Domain

Status: approved capability boundary; Provider Spike v2 is **not accepted as a
visual-quality baseline**. The first real-image run exposed structural
failures in scene classification, redraw isolation, transparency, geometry,
and QA. The provider spike is being revised before another external-model run.

This directory is the proposed host-neutral vertical module for AI image
understanding, generative processing, deterministic raster operations, and
structured reconstruction.

The first proposed capability is `image.to-editable.v1`. Future capabilities
such as upscale, background removal, inpainting, and vectorization should be
added here only when a concrete user workflow requires them. They are not
prerequisites for image-to-editable.

Capability-private contracts, orchestration, processing, and adapters stay
cohesive here. Promote code to `src/packages/` or `src/providers/` only after an
independent cross-domain consumer proves a stable shared boundary.

Canonical proposal:

- `docs/internal/image-to-editable/技术方案.md`
- APCC architecture decision `ai-3` (`approved`)

The current implementation includes a host-neutral VLM/Image Edit pipeline,
context-aware scene roles, local spatial redraw batches, Edit-only background
repair, automatic alpha crop detection, SVG assembly, and per-element
transparency/geometry QA. Failed model assets are never silently published: the pipeline may emit an
explicitly marked `source-preserving-fallback` asset to protect visual
fidelity, but that conversion remains `partial` and does not pass the
transparent-redraw gate. A repaired clean background is still produced for
diffuse gradients, fused shadows, and other hard-to-separate base fields;
clearly bounded complex artwork remains an independent raster layer.

The previous real sample evidence under
`delivery/evidence/image-to-editable/provider-spike-v2/` is retained as a
failing regression fixture, not as a quality proof. A new analysis-only
checkpoint must be reviewed before any new Image Edit calls. Standalone job
execution, a broader fixed evaluation set, and host integration are not yet
implemented.
