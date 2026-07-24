# Email Package

Transactional email templates and delivery contracts live here.

The starter includes React Email templates for account verification, password reset, and email change confirmation. They run in local-test mode by default and switch to Resend when `RESEND_API_KEY` and `RESEND_FROM` are configured. Keep provider-specific delivery behind this package boundary so the product can replace Resend without changing auth workflows.
