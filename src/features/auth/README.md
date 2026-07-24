# Auth Feature

SaaS Starter includes email/password registration, email verification, login, password reset, change password, verified email change, and auth mutation rate limiting through Better Auth.

Keep auth UI in `src/apps/web/app/(auth)/(login|register|verify-email|forgot-password|reset-password)`, keep the shared auth page shell in `src/apps/web/app/(auth)/layout.tsx`, and shared auth contracts in `src/packages/contracts`.
