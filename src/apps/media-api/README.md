# Media API App

Status: composition-root placeholder; not runnable.

This app is reserved for the host-neutral asynchronous Media API. It will expose
versioned conversion submission, inspection, cancellation, retry, and result
delivery after architecture decision `ai-3` is approved.

It must not expose Muses domain types or share Muses authority tables. Do not
add it to OpenAPI, ANSS discovery, Docker, or the workspace build before the
contract gate passes.
