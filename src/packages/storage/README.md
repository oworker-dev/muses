# Storage Package

Object storage contracts live here.

The default local runtime starts MinIO through Docker Compose. Product code should depend on storage ports, not direct provider calls, so S3-compatible cloud storage can replace it later.

The default API exposes a presigned upload contract for direct browser-to-storage PUT uploads. The Account Console uses the same boundary for avatar uploads, which gives users a concrete storage-backed experience without turning the starter into a file-management product, media library, or admin console.
