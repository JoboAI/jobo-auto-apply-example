# Security policy

## Reporting a vulnerability

Email **support@jobo.world** with "Security" in the subject, a description,
steps to reproduce and the impact you expect. Please do not open a public
issue. We will acknowledge your report and keep you updated until it is fixed.

This covers this example application and the Jobo APIs it calls. For the
hosted demo at demo.jobo.world, test only against accounts you created, and do
not attempt to access other users' data or degrade the service.

## What this app protects

If you deploy your own copy, these are the sensitive parts:

- **API keys and secrets** (`.env.local`): server-side only, never
  `NEXT_PUBLIC_`. Recorded API exchanges redact every configured secret.
- **Visitors' Jobo API keys** (sandbox and production): stored AES-256-GCM sealed
  with `API_KEY_ENCRYPTION_SECRET` (`lib/secret-box.ts`), and erased from an
  application once it finishes.
- **Resumes**: served to their owner, or to Jobo through a short-lived URL
  signed with `RESUME_URL_SIGNING_SECRET` and scoped to one application.
- **Self-identification answers** are filled by fixed rules and never sent to
  the language model.

Keep dependencies current (`npm audit`, `npm outdated`), and rotate a secret
if it may have leaked: rotating `API_KEY_ENCRYPTION_SECRET` disconnects every
stored visitor key.
