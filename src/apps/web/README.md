# Web App

This is the default web surface for OWorker SaaS Starter.

It contains:

- the neutral single-file landing page
- email/password auth pages
- optional OAuth buttons
- email verification UI
- password reset UI
- protected account center
- account avatar upload backed by S3-compatible storage
- account billing and payment record UI
- site-admin visibility UI
- first-party analytics event ingestion
- account security forms for password and verified email changes
- billing routes for checkout, portal, and webhooks
- React Email templates for account verification, password reset, and email change confirmation
- database-backed Better Auth rate limiting
- default security headers from `next.config.mjs`

shadcn/ui is the default UI primitive baseline. Keep primitives that are used by real starter pages, and add more shadcn components only when the product needs them.

The app uses `next-themes` with class-based theming. Keep page surfaces on Tailwind theme tokens such as `bg-background`, `text-foreground`, `bg-card`, and `text-muted-foreground` instead of hardcoded light-only colors.

Transactional email templates live in `emails/` and render through `@react-email/render` before they are passed to the email provider boundary.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button";
```
