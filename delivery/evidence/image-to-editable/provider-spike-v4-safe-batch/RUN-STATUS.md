# Provider Spike v4 Status

This directory contains a partial run using the v3 analysis checkpoint and the
current depth-safe redraw scheduler.

- Vision analysis: completed from the supplied checkpoint.
- Element redraws: 8 completed before the provider stopped accepting requests.
- Failure: image provider returned `403 insufficient_user_quota` with remaining
  quota `¥0.000000`.
- Final SVG and QA: intentionally not published because the redraw set is
  incomplete.

The partial raster outputs are retained for request/provenance debugging only;
they are not a quality result and must not be used as a delivery artifact.
