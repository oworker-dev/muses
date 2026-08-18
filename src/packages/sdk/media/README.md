# Media Client SDK

Status: client placeholder; not published.

This directory is reserved for host-facing Media API contracts and transport
clients. It will not contain server orchestration, image processing, Provider
SDKs, credentials, queue consumers, or persistence code.

Muses and other hosts should eventually depend on this client rather than
importing `src/capabilities/ai-image` server implementation.
