# Gate 1 Engineering Evidence

Date: 2026-07-28

Environment: local Docker stack, Studio `http://127.0.0.1:4730/studio`

> Historical evidence: this run predates `WorkflowDocument 0.6.0-draft` and the
> image input/resolution correction. The current adapter stores provider bytes
> as returned and reports actual metadata; it no longer performs the implicit
> cover-crop recorded below.

## Outcome

The default professional workspace now completes the intended engineering path:

```text
Start → image.generate → End
```

One real provider image was generated, normalized when the compatible endpoint
did not honor the requested dimensions, persisted to MinIO, projected as the
End output, restored after browser and Web/Workflow restarts, inspected in the
result panel, and downloaded without leaving Studio.

This proves the engineering loop. It does not pass the product value Gate by
itself: the product owner must still complete the task without guidance and
record pauses, misunderstandings, first-image time, and the natural next action.

## Real Run

- Run: `wrun_01KYJK731P2ATC2F9GWJ0RT43K`
- Runtime: `muses-workflow-runtime`
- Completed nodes: `start-1`, `image-generator-1`, `end-1`
- Asset: `image_3b3674ce69411d9b2b231d78`
- Model/provider: `gpt-image-2` / `openai`
- Requested and stored output: PNG, `1024 × 1024`
- Provider response before normalization: `1024 × 1536`
- Normalization: attention-based `cover-crop`
- Browser image dimensions before and after refresh: `1024 × 1024`
- Download: `image_3b3674ce69411d9b2b231d78.png`, no browser failure,
  Studio remained open
- Browser console errors: `0`

The live response's signed storage URL is intentionally excluded from evidence.
The stable Run and Asset identities are sufficient for local audit without
publishing an expiry-bearing access token.

## Automated Verification

- Domain: 3 files, 25 tests passed.
- Studio: 7 Playwright tests passed, including the default first-image path,
  Harness waiting/resume/cancel/retry, typed continuation, singleton inputs,
  and real-time node dragging.
- Web TypeScript passed.
- Next production build and Workflow compilation passed.
- Download endpoint returned `Content-Disposition: attachment`, `image/png`,
  exact `1024 × 1024` bytes, and generic `404` for wrong workspace or unknown
  Asset.

## Artifacts

- `results.json`: structured non-secret verification facts.
- `real-image-result.png`: restored real Run in the professional Studio.
- `user-path-audit.md`: pre-implementation user-path baseline and gap decision.

## Remaining Gate Work

- Product-owner no-guidance acceptance is still pending.
- Provider-level request idempotency, authenticated tenant ownership, real cost
  accounting, and aborting an in-flight provider request remain explicit gaps;
  they must be pulled only when acceptance or the next real task proves they
  block value or safety.
