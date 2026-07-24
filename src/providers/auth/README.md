# Better Auth Provider

The default auth provider is Better Auth with email/password sessions, email verification, password reset, password change, OAuth-only local password setup, connected-account linking and unlinking, verified email change, and database-backed rate limiting.
GitHub and Google OAuth are available when the matching environment variables are configured. The auth UI hides an OAuth provider until both its server credentials and its enable flag are set, so a clean local run does not show buttons that cannot complete authorization.
OAuth login can mark the app email as verified when the trusted provider returns a verified identity. OAuth provider emails remain managed by the provider; changing the app account email still uses the verified email-change flow.

Provider-specific route handlers and database wiring stay in the app/provider layer. Product use cases should depend on auth contracts, not Better Auth internals.
