# MinIO Storage Provider

The default object storage provider is MinIO, which is S3-compatible and runs locally through Docker Compose.

Use `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` for provider adapters.

`S3_ENDPOINT` is the server-side endpoint used by the API runtime. `S3_PUBLIC_ENDPOINT` is the browser-reachable endpoint used when signing presigned upload URLs. For cloud S3-compatible providers these may be the same URL; for Docker they are usually different.
