# First Image Gate User-Path Audit

Date: 2026-07-28

Environment: local Docker Web at `http://127.0.0.1:4730/studio`, light theme, 1600x1000 viewport

Role: product-owner proxy, no source-code assistance during the path

## Intended outcome

Generate one real image through the professional-mode
`Start → image.generate → End` path, inspect it, and know how to continue using
it.

## Template-path observation

The current default opens a five-node Harness:

```text
Start → Generate image → Human review → Design canvas → End
```

The image node declares `Muses Image (local test)`, `16:9`, and an image count
of `3`. Running it returns three deterministic SVG directions in about 0.2
seconds of browser time while the fixture reports a synthetic duration of 1.8
seconds and zero credits. The result is not a real model output.

## Blank-path observation

There is no blank first-image workflow or first-image template selector. Reset
restores the five-node Harness. The node library can add Image, Human review,
and Design canvas nodes, but it does not provide a user path that begins with
protected Start/End and explains how to create the minimum image chain.

## Confirmed gaps

| Severity | Gap | User impact | Minimum correction |
| --- | --- | --- | --- |
| G0 | No real image provider is connected | The product cannot produce the promised result | Add one replaceable server-side provider adapter in a durable step |
| G1 | Default count is fixed to three | Behavior contradicts an unconfigured user request | Make count explicit and default it to one |
| G1 | Selector and DesignDocument are mandatory defaults | The path teaches a test Harness instead of image creation | Make the default template `Start → image.generate → End` |
| G1 | Prompt, aspect ratio, model, count, and cost are not editable/predictable | The user cannot state what will happen before running | Add task-oriented configuration and run-input controls |
| G0 | End accepts only a DesignDocument | A generated image cannot be the workflow deliverable | Allow End to accept image output |
| G2 | Browser fixture assets are the only visible results | Refresh, ownership, provenance, and duplicate effects are not product facts | Return a server-owned run result with stable image metadata and idempotent submission |
| G3 | Runtime/Harness terminology dominates the result | The user must interpret implementation details | Make the image the primary completed state and fold technical evidence away |

## Decision

Proceed with one vertical correction covering the confirmed G0-G2 gaps. Keep
the existing three-result Selector/DesignDocument flow only as a named Gate 0
Harness and regression fixture. Do not add image editing, multiple providers,
Agent behavior, PPT nodes, or a general plugin runtime in this slice.

## Engineering Resolution

The audit above is the pre-implementation baseline. The G0-G2 corrections were
verified on 2026-07-28:

- default workspace changed to `Start → image.generate → End`;
- count defaults to one and Prompt/model/ratio/count/quality are editable;
- one real server-side image adapter runs in a non-retrying durable Step;
- End returns the typed image value directly;
- image bytes are stored in MinIO with stable Asset and provenance metadata;
- the image is the primary completed result and survives refresh/runtime restart;
- provider dimension mismatches are normalized with recorded provenance;
- the download action now returns a same-origin attachment and keeps Studio open;
- the five-node flow is isolated at `/studio?template=harness`.

See `README.md`, `results.json`, and `real-image-result.png` in this directory.
The product-owner no-guidance task remains pending and is the only authority for
passing, revising, or stopping Gate 1.
