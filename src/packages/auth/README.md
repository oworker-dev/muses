# Auth Package

Auth domain contracts and framework-independent session policies live here.

The default provider is Better Auth, wired from `src/providers/auth` and the Web app route handler. The starter baseline includes email verification, password reset, change password, verified email change, session revocation, and database-backed auth rate limiting. Enterprise SSO, API keys, and service tokens should be added as explicit capabilities.
