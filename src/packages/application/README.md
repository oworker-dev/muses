# Application Package

Application use cases live here. Web, API, MCP, and worker apps should call this layer instead of duplicating business logic.

Keep provider SDKs outside this package. Depend on domain ports and inject adapters from `src/providers`.
