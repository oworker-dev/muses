# DB Package

Business-owned database schema and migrations live here.

Better Auth owns its internal auth tables through its adapter. Product tables should be described here with Drizzle-compatible schema files and mirrored migrations.

The starter baseline includes thin SaaS tables for account subscription state, payment records, first-party analytics events, analytics rollups, account activity summaries, and audit logs. Keep vertical business data in the created product, not in the starter baseline.
