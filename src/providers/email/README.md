# Resend-Compatible Email Provider

The default email provider is local-test so the starter remains runnable without cloud credentials.

When `RESEND_API_KEY` and `RESEND_FROM` are configured, account verification email sends through Resend. Without them, the same auth workflow runs in local-test mode and prints the email payload from the web process.

Email content is rendered from React Email templates before it reaches the provider adapter. Provider replacement should not require changing auth workflows or page code.

For local Resend testing, `onboarding@resend.dev` works before domain verification, but Resend restricts recipients to addresses allowed by that account. Verify a sending domain before treating arbitrary recipient delivery as production-ready.
