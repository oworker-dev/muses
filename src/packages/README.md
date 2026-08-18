# Packages

Shared contracts, domain logic, SDKs, config, validation, and reusable helpers live here.

Do not move capability-private code here only because it may be reusable later.
Keep a model workflow, raster algorithm, or capability-specific adapter inside
its owning capability until at least one independent consumer proves a stable
shared boundary.
