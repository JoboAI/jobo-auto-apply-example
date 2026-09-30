# Jobo Auto Apply Demo

An interactive **Auto Apply API demo for developers** at **demo.jobo.world**, with private accounts and fictional sandbox jobs. Apply directly from job cards, follow persisted progress without leaving the catalog, and explore the implementation to integrate Auto Apply into your own app. No real employers are contacted. Sign up, verify your email, upload a PDF resume, complete contact details and common application answers, review your profile, discover sandbox roles, and apply. A durable worker finishes applications even after the browser closes.

Source: [JoboAI/jobo-auto-apply-example on GitHub](https://github.com/JoboAI/jobo-auto-apply-example).

## Run locally

```sh
npm ci
cp .env.example .env.local
# Fill the server credentials, independent signing/auth secrets, and Brevo sender.
# Set BETTER_AUTH_URL=http://localhost:3000 for local login.
npm run dev
# In another terminal, load the same environment for the background worker:
node --env-file=.env.local --import tsx scripts/worker.ts
```

`PUBLIC_BASE_URL` must be publicly reachable HTTPS for Jobo to download signed resume snapshots. A localhost-only app supports account/profile development, but cannot complete resume-required applications against the hosted service. New accounts require a verification email. Brevo is used for verification and password recovery; email failures are not replaced with fake success.

The job feed is a board of fictional postings served by `https://sandbox.jobo.world/api/jobs`. Each posting is a real application form on the sandbox (`/apply/{job}`), built on one of its tested form types — multi-step, repeating work history, conditional questions, async typeaheads and so on. Deploy the sandbox metadata endpoint alongside this app. The sandbox's test scenarios, including the deliberately failing ones, stay on their own `/apply/{scenario}` URLs and are never in this feed. No live-employer URL can be submitted through this product.

## Answer generation

OpenRouter uses `~deepseek/deepseek-v4-flash-latest`, the official latest alias in the DeepSeek V4 Flash family. Name, email, dates, file URLs, repeating groups, and exact selections are filled deterministically; the remaining eligible fields go in a single structured model request per step. It sees the reviewed profile, resume text, and job description. The actual resolved model and duration are recorded per exchange.

Reasoning is disabled. The model has a maximum 45-second budget, shortened to leave 20 seconds before the application step deadline. JSON and field values are validated, and one mechanical validation repair is allowed. Sensitive fields use only advertised decline options. Missing facts, verification codes, or model failures stop the application with an explanation. There is no fallback to a different model family.

## Accounts, files, and execution

- Better Auth owns email/password accounts, verification, recovery, sessions, and auth rate limits. Every data action and protected route validates account ownership.
- A real SQLite database stores accounts, profiles, resume metadata, saved jobs, applications, and answer exchanges at `DATA_DIR/app.db` (`.data/app.db` locally, `/data/app.db` on the deployment’s persistent volume). PDF files live separately in `DATA_DIR/resumes`. Existing unowned demo data remains inaccessible; production no longer seeds shared profiles.
- Each Apply click snapshots the profile JSON and copies the PDF. Editing or archiving the profile cannot change a running application. Ordinary PDF downloads require ownership; the worker generates expiring signatures for application-specific PDF downloads.
- The worker claims jobs transactionally with renewable leases. Defaults are two applications globally and one per user. The browser only refreshes progress; it does not advance execution.
- Create idempotency keys are persisted before network calls. Answers are saved before submission and replayed after interruption. Confirmed successful and uncertain submissions cannot be started again by double-clicking or forcing retry.
- Transient failures back off. After six failed exchanges, the worker switches to cancellation/reconciliation when an upstream ID is known; otherwise it pauses for operator review. The UI reports that the final state is being checked. Creation is never replayed beyond the safe 20-hour recovery window. Such unreconciled records remain blocked from duplicate submission and require operator investigation.
- Submitted is displayed only for upstream `submitted`. A canceled application with a missing-information/model failure is shown as Couldn’t Complete. User-requested cancellations show Canceled.

## Deployment

The existing single-replica Kubernetes deployment runs an init migration container, a Next.js web container, and a worker container on the same ReadWriteOnce volume. Recreate deployment strategy is required; do not scale replicas or mount this SQLite database across hosts. Worker probes check its database heartbeat.

Before upgrading, back up the **entire volume**, including PDFs. The migration also creates a `before-accounts-*.db` SQLite backup automatically when it detects the pre-account schema. It never assigns legacy profiles to new accounts. Keep the volume backup for rollback: restoring the old image alone does not roll back the schema.

The renderer reads `autoApplyDemo.authSecret` (or `JOBO_DEPLOY_AUTO_APPLY_AUTH_SECRET`) and the existing `brevoApiKey`. Production workflows pass the `mono-prod` environment secret `AUTO_APPLY_AUTH_SECRET` as this override. Provide an independent, random auth secret of at least 32 characters. The deployment sets the latest Flash alias explicitly, restricts the sandbox host, and uses `https://demo.jobo.world` for account links and resume downloads. Web readiness reports missing configuration names only. Do not send secrets to the frontend.

Validate the catalog, a verified signup, PDF upload/review, and one sandbox-only application after deployment. Ensure the application finishes after the browser closes and the worker resumes after a restart. No deployment credentials or new auth secret are committed by this change.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The browser suite uses an isolated test server and fixture network responses. It never sends real email, invokes OpenRouter, or submits a real application. Unit/integration tests exercise the actual account lifecycle, ownership boundaries, snapshots, durable leases, answer validation, and signed resume access.

PDF upload supports text-based files up to 5 MB. OCR, DOCX, billing, real-employer jobs, bulk application, mailbox connections, and native mobile apps are outside this release.

### Profile onboarding

After PDF extraction, a three-step review collects contact details, common application answers, and a final resume check. Full name, valid email, phone, and an HTTPS personal LinkedIn `/in/` URL are required. Client and server share validation; older reviewed profiles missing those details must be completed before a new application can start. Each Continue saves a draft; only final confirmation makes a new profile ready.

Location, work authorization, sponsorship, availability, and relocation preferences are recommended and may remain unanswered. The engine stops if a required application fact is unavailable. EEO demographic data is not collected or inferred. Users choose either the form’s advertised “prefer not to answer” option (default), or leaving sensitive fields blank. This preference is saved with the profile and snapshotted per application; sensitive fields never go to the model.

The demo reads job metadata, availability, and application URLs from `https://sandbox.jobo.world/api/jobs`. The retired public API scenario endpoint is not used. Sandbox catalog availability describes the forms; the Auto Apply API separately enforces account access and quotas during creation.

### API exchange preview

Application details include a collapsed **API requests & responses** inspector. New worker calls capture the actual SDK HTTP requests, responses, errors, and retries in the application's private SQLite audit trail. Authentication headers, cookies, known server secrets, and signed download tokens are removed before storage. Captures are limited to the first 100 calls per application and 64K characters per JSON preview; truncation is identified. Old applications have no historical HTTP capture. A missing response is never treated as proof of submission.
