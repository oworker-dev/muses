# Image To Editable

Status: Provider Spike v2 is retained as a failed visual-quality regression
sample; the revised pipeline is under review and no HTTP API is available.

Proposed capability ID: `image.to-editable.v1`.

This directory owns the capability-specific contracts and implementation after
architecture decision `ai-3` was approved. It remains host-neutral and does not
import Muses Workspace, credit, DesignDocument, canvas, database, or UI types.

Read the canonical technical design before adding code:

- `docs/internal/image-to-editable/技术方案.md`
- `docs/internal/image-to-editable/评审清单.md`

Deterministic fixture command:

```bash
pnpm --filter @muses/ai-image reconstruct:fixture -- \
  --input /root/a.png \
  --output delivery/evidence/image-to-editable/corporate-report
```

Real VLM structure gate (run before Image Edit):

```bash
AI_IMAGE_VISION_MODEL=gpt-5.6-sol \
AI_IMAGE_VISION_REASONING_EFFORT=low \
AI_IMAGE_VISION_MAX_OUTPUT_TOKENS=16000 \
pnpm --filter @muses/ai-image convert:openai -- \
  --input /root/a.png \
  --output delivery/evidence/image-to-editable/provider-spike-v2-analysis \
  --analysis-only
```

After the structure gate passes, reuse that exact receipt and analysis for the
Image Edit stages with `--analysis-checkpoint <analysis-only.json>`; this avoids
paying for or drifting through a second VLM analysis.

The provider-backed conversion command resolves relative input and checkpoint
paths from the repository root. Element redraws are processed depth-by-depth;
independent batches within one depth may run concurrently. The default is three
in-flight Edit requests and can be changed explicitly with
`--redraw-concurrency <1..8>` when the image provider has a different rate
limit.

```bash
AI_IMAGE_VISION_MODEL=gpt-5.6-sol \
AI_IMAGE_EDIT_MODEL=gpt-image-2 \
pnpm --filter @muses/ai-image convert:openai -- \
  --input delivery/evidence/image-to-editable/provider-spike-v3/inputs/source.png \
  --output delivery/evidence/image-to-editable/provider-spike-v4-safe-batch \
  --analysis-checkpoint delivery/evidence/image-to-editable/provider-spike-v3-analysis/analysis-only.json \
  --redraw-concurrency 3 \
  --quality medium --force
```

The provider pipeline treats diffuse/fused background fields as the editable
clean background, keeps clearly bounded complex artwork as independent raster
layers, redraws foreground rasters in small local spatial/semantic batches
through Edit-only requests, subtracts descendants from parent assets, and uses
detected alpha bounds without forcing malformed aspect ratios into the logical
slot. Ordinary text remains native SVG.

The analysis-only checkpoint is a hard gate. Review scene roles and roots first;
do not run Image Edit until bounded artwork, chart/card grouping, and background
field classification are accepted. The final QA must pass per-element chroma,
edge, truncation, and geometry checks; global pixel similarity alone is not a
pass criterion.

Historical failed evidence (kept for regression comparison):

- `delivery/evidence/image-to-editable/provider-spike-v2/editable.svg`
- `delivery/evidence/image-to-editable/provider-spike-v2/scene-manifest.json`
- `delivery/evidence/image-to-editable/provider-spike-v2/qa.json`
- 99 text layers, 24 raster layers, one editable background, similarity `0.9073`,
  but visual quality failed due to background swallowing, redraw noise,
  chroma leakage, and geometry drift.
