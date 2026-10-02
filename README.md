# Jobo Auto Apply Demo

An interactive **Auto Apply API demo for developers** at **demo.jobo.world**, with private accounts and fictional sandbox jobs. Apply directly from job cards, follow persisted progress without leaving the catalog, and explore the implementation to integrate Auto Apply into your own app. No real employers are contacted. Sign up, verify your email, upload a PDF resume, complete contact details and common application answers, review your profile, discover sandbox roles, and apply. A durable worker finishes applications even after the browser closes.

Source: [JoboAI/jobo-auto-apply-example on GitHub](https://github.com/JoboAI/jobo-auto-apply-example).

## Run locally

Needs Docker for the local Postgres (`docker-compose.yml`, on `127.0.0.1:5433`), or any Postgres you point `DATABASE_URL` at.

```sh
npm ci
cp .env.example .env.local
# Fill the server credentials, independent signing/auth secrets, and Brevo sender.
# Set BETTER_AUTH_URL=http://localhost:3000 for local login.
npm run db:up      # starts Postgres
npm run dev        # applies migrations, then starts Next.js
# In another terminal, load the same environment for the background worker:
node --env-file=.env.local --import tsx scripts/worker.ts
```

`PUBLIC_BASE_URL` must be publicly reachable HTTPS for Jobo to download signed resume snapshots. A localhost-only app supports account/profile development, but cannot complete resume-required applications against the hosted service. New accounts require a verification email. Brevo is used for verification and password recovery; email failures are not replaced with fake success.

The job feed is a board of fictional postings served by `https://sandbox.jobo.world/api/jobs`. Each posting is a real application form on the sandbox (`/apply/{job}`), built on one of its tested form types — multi-step, repeating work history, conditional questions, async typeaheads and so on. Deploy the sandbox metadata endpoint alongside this app. The sandbox's test scenarios, including the deliberately failing ones, stay on their own `/apply/{scenario}` URLs and are never in this feed. No live-employer URL can be submitted through this product.

## Answer generation

OpenRouter uses `~deepseek/deepseek-v4-flash-latest`, the official latest alias in the DeepSeek V4 Flash family. Name, email, dates, file URLs, repeating groups, and exact selections are filled deterministically; the remaining eligible fields go in a single structured model request per step. It sees the reviewed profile, resume text, and job description. The actual resolved model and duration are recorded per exchange.

Reasoning is disabled. The model has a maximum 90-second budget, shortened to leave 20 seconds before the application step deadline, and OpenRouter is asked to route by throughput (`OPENROUTER_PROVIDER_SORT`) to hosts that honour the JSON schema: price routing reached hosts that took over a minute. JSON and field values are validated, and one mechanical validation repair is allowed. Sensitive fields use only advertised decline options. A failed model call is not fatal on its own: the profile answers are still sent when they cover every required field. A required field with no answer, a verification code, or a refused API key stops the application with an explanation, and the answers panel lists every field that was not answered and why. There is no fallback to a different model family.

## Accounts, files, and execution

- Better Auth owns email/password accounts, verification, recovery, sessions, and auth rate limits. Every data action and protected route validates account ownership.
- Postgres (`DATABASE_URL`) stores accounts, profiles, resume metadata, saved jobs, applications, and answer exchanges. `npm run db:migrate` applies `db/migrations`; regenerate them from `db/schema.ts` with `npm run db:generate`. PDF files live separately in `DATA_DIR/resumes`, because Jobo downloads them over HTTP. Production never seeds shared profiles.
- Each Apply click snapshots the profile JSON and copies the PDF. Editing or archiving the profile cannot change a running application. Ordinary PDF downloads require ownership; the worker generates expiring signatures for application-specific PDF downloads.
- The worker claims jobs with renewable leases, under a Postgres advisory lock so concurrent claims cannot exceed the caps. Defaults are two applications globally and one per user. The browser only refreshes progress; it does not advance execution.
- Create idempotency keys are persisted before network calls. Answers are saved before submission and replayed after interruption. Confirmed successful and uncertain submissions cannot be started again by double-clicking or forcing retry.
- Transient failures back off. After six failed exchanges, the worker switches to cancellation/reconciliation when an upstream ID is known; otherwise it pauses for operator review. The UI reports that the final state is being checked. Creation is never replayed beyond the safe 20-hour recovery window. Such unreconciled records remain blocked from duplicate submission and require operator investigation.
- Submitted is displayed only for upstream `submitted`. A canceled application with a missing-information/model failure is shown as Couldn’t Complete. User-requested cancellations show Canceled.

## Deployment

The single-replica Kubernetes deployment runs an init migration container (`npm run db:migrate`), a Next.js web container, and a worker container against a dedicated Postgres, and shares a ReadWriteOnce volume for resume PDFs. Recreate deployment strategy is required while the PDFs live on that volume; do not scale replicas. Worker probes check its database heartbeat.

Migrations are forward-only: restoring an older image does not roll back the schema. Back up the database and the PDF volume before upgrading.

The renderer reads `autoApplyDemo.authSecret` (or `JOBO_DEPLOY_AUTO_APPLY_AUTH_SECRET`) and the existing `brevoApiKey`. Production workflows pass the `mono-prod` environment secret `AUTO_APPLY_AUTH_SECRET` as this override. Provide an independent, random auth secret of at least 32 characters. The deployment sets the latest Flash alias explicitly, restricts the sandbox host, and uses `https://demo.jobo.world` for account links and resume downloads. Web readiness reports missing configuration names only. Do not send secrets to the frontend.

`DATABASE_URL` comes from the same Secret, composed from `autoApplyDemo.postgresPassword`.

Validate the catalog, a verified signup, PDF upload/review, and one sandbox-only application after deployment. Ensure the application finishes after the browser closes and the worker resumes after a restart. No deployment credentials or new auth secret are committed by this change.

## Checks

```sh
npm run db:up      # the tests create a throwaway database per file here
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Tests need Postgres: `npm run db:up`, or set `TEST_DATABASE_URL` to a login that may create databases. The browser suite uses an isolated test server, its own database, and fixture network responses. It never sends real email, invokes OpenRouter, or submits a real application. Unit/integration tests exercise the actual account lifecycle, ownership boundaries, snapshots, durable leases, answer validation, and signed resume access.

PDF upload supports text-based files up to 5 MB. OCR, DOCX, billing, real-employer jobs, bulk application, mailbox connections, and native mobile apps are outside this release.

### Profile onboarding

After PDF extraction, a three-step review collects contact details, common application answers, and a final resume check. Full name, valid email, phone, and an HTTPS personal LinkedIn `/in/` URL are required. Client and server share validation; older reviewed profiles missing those details must be completed before a new application can start. Each Continue saves a draft; only final confirmation makes a new profile ready.

Location, work authorization, sponsorship, availability, and relocation preferences are recommended and may remain unanswered. The engine stops if a required application fact is unavailable. EEO demographic data is not collected or inferred. Users choose either the form’s advertised “prefer not to answer” option (default), or leaving sensitive fields blank. This preference is saved with the profile and snapshotted per application; sensitive fields never go to the model.

The demo reads job metadata, availability, and application URLs from `https://sandbox.jobo.world/api/jobs`. The retired public API scenario endpoint is not used. Sandbox catalog availability describes the forms; the Auto Apply API separately enforces account access and quotas during creation.

### API exchange preview

Application details include a collapsed **API requests & responses** inspector. New worker calls capture the actual SDK HTTP requests, responses, errors, and retries in the application's private audit trail in Postgres. Authentication headers, cookies, known server secrets, and signed download tokens are removed before storage. Captures are limited to the first 100 calls per application and 64K characters per JSON preview; truncation is identified. Old applications have no historical HTTP capture. A missing response is never treated as proof of submission.
