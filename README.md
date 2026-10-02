# Jobo Auto Apply Demo

A working example of integrating the Jobo Auto Apply API into a Next.js app. Candidates create a private account, upload and review a resume, then apply to fictional jobs while a background worker handles the application loop. No real employers are contacted.

**[Try the live demo](https://demo.jobo.world)** · **[Read the Auto Apply docs](https://jobo.world/docs/api-reference/auto-apply/auto-apply)** · **[View the source](https://github.com/JoboAI/jobo-auto-apply-example)**

## Try it without installing anything

1. Open [demo.jobo.world](https://demo.jobo.world), sign up, and verify your email.
2. Upload a text-based PDF resume, up to 5 MB.
3. Review your contact details, common application answers, and resume. Full name, email, phone, and a personal LinkedIn `/in/` URL are required.
4. Choose a fictional role and click **Apply**. Follow progress on the job card or application detail page.
5. Expand **API requests & responses** to inspect the integration's recorded HTTP exchanges. Credentials and signed download tokens are redacted.

The worker continues after the browser closes. Missing required information stops the application with an explanation. **Submitted** is shown only when the upstream API reports `submitted`.

## What this example demonstrates

| This app owns | Auto Apply handles |
| --- | --- |
| Accounts, consent, reviewed profiles, and resume files | Opening the supported application form |
| Mapping candidate facts and generating eligible free-text answers | Discovering typed fields and validation constraints |
| Saving progress and recovering worker interruptions | Filling answers, advancing pages, and reporting corrections |
| Presenting results and handling uncertain submissions | Reporting `submitted`, `failed`, or `canceled` |

The API does not store reusable candidate profiles or generate candidate answers. Those features live in this example. The integration uses `@jobo-ai/autoapply` and the synchronous create → fields → answers → next step loop. Long-running requests may return `202`; the worker re-attaches to the existing application. No webhook receiver is required.

Read the [application loop](https://jobo.world/docs/api-reference/auto-apply/flow), [field schema](https://jobo.world/docs/api-reference/auto-apply/schema), and [optional email verification guide](https://jobo.world/docs/api-reference/auto-apply/mailboxes) when adapting it.

## Run locally

### Prerequisites

- **Node.js 22+** and npm.
- **Postgres**, either through Docker Compose or your own `DATABASE_URL`.
- A **Jobo API key with Auto Apply beta access**. [Request access in the portal](https://enterprise.jobo.world/auto-apply/applications). Creating a demo account does not enable API access on your own key.
- An **OpenRouter API key** for resume extraction and answer generation.
- A **Brevo API key and configured sender** for verification and password recovery emails.
- A **public HTTPS origin** pointing to your app for signed resume downloads when running applications.

### 1. Clone and install

```sh
git clone https://github.com/JoboAI/jobo-auto-apply-example.git
cd jobo-auto-apply-example
npm ci
cp .env.example .env.local
```

### 2. Configure the environment

Edit `.env.local`. All credentials stay server-side; do not prefix them with `NEXT_PUBLIC_`.

| Variable | What to set |
| --- | --- |
| `JOBO_API_KEY` | An account API key with Auto Apply access (`jbe_live_…` or `jbe_test_…`) |
| `JOBO_API_BASE_URL` | Keep `https://connect.jobo.world` for the hosted API |
| `DATABASE_URL` | The example's default uses local Postgres on port `5433` |
| `OPENROUTER_API_KEY` | Your OpenRouter credential |
| `BREVO_API_KEY` | Your transactional email credential |
| `AUTH_EMAIL_FROM` | A sender configured in your Brevo account |
| `BETTER_AUTH_URL` | `http://localhost:3000` for local login, or your deployed app's origin |
| `BETTER_AUTH_SECRET` | An independent random secret, at least 32 characters |
| `RESUME_URL_SIGNING_SECRET` | A different random secret, at least 32 characters |
| `PUBLIC_BASE_URL` | Your app's publicly reachable HTTPS origin on port 443, without a path |
| `DATA_DIR` | A writable directory for PDFs; defaults to `./.data` |
| `API_KEY_ENCRYPTION_SECRET` | Optional. At least 32 random characters; enables [production mode](#production-mode), where visitors apply to real jobs on their own Jobo API key |

Generate each secret separately, for example with `openssl rand -hex 32`.
Replace the `https://demo.jobo.world` origin values in the example environment;
that hosted site cannot serve files from your local database.

The browser can use localhost for account/profile development, but Jobo must be able to download resumes from `PUBLIC_BASE_URL`. Use your own deployed app or an HTTPS tunnel to the local web server. The worker and web server must share the same database, PDF directory, and signing secret. Email delivery must work for new accounts to verify; email failures are reported rather than treated as success.

Keep the sandbox settings from `.env.example`. Sandbox mode only ever applies to `sandbox.jobo.world`, enforced in code. Applications to real employers happen only in [production mode](#production-mode), on the visitor's own API key, after they accept a warning.

### 3. Start the web app

```sh
npm run db:up       # omit if using your own Postgres
npm run dev         # applies migrations, then starts Next.js on port 3000
```

### 4. Start the worker

In a second terminal, from the same directory:

```sh
node --env-file=.env.local --import tsx scripts/worker.ts
```

The standalone worker needs its environment loaded explicitly. Starting only the web app leaves applications queued. In a service or container where variables are already injected, use `npm run worker`.

### 5. Check the setup

With the web app running:

```sh
npm run doctor
```

The preflight checks configuration and service connectivity. Then open [localhost:3000](http://localhost:3000), verify a new account, and complete one sandbox application. Confirm it continues with the browser closed.

## Find your way around the code

| Path | Responsibility |
| --- | --- |
| [`lib/application-engine.ts`](lib/application-engine.ts) | Durable create, answer, wait, cancellation, and recovery logic |
| [`lib/queue.ts`](lib/queue.ts), [`scripts/worker.ts`](scripts/worker.ts) | Worker claims, leases, concurrency, and execution |
| [`lib/jobo/client.ts`](lib/jobo/client.ts) | Auto Apply SDK configuration |
| [`lib/answers/`](lib/answers/) | Deterministic answers, model prompts, validation, and repair |
| [`lib/resume/`](lib/resume/) | PDF extraction, reviewed profile data, and file storage |
| [`lib/jobs.ts`](lib/jobs.ts) | Fictional job catalog from the sandbox |
| [`lib/auth.ts`](lib/auth.ts), [`lib/session.ts`](lib/session.ts) | Account and session handling |
| [`lib/jobo/api-preview.ts`](lib/jobo/api-preview.ts) | Redacted HTTP exchange previews |
| [`db/schema.ts`](db/schema.ts), [`db/migrations/`](db/migrations/) | Database schema and forward migrations |
| [`app/`](app/), [`components/`](components/) | Routes and candidate-facing UI |

## Answer generation

Name, email, dates, file URLs, repeating groups, and exact selections are filled deterministically. Eligible remaining fields go in one structured OpenRouter request per step using the reviewed profile, resume text, and job description. The configured answer model defaults to `~deepseek/deepseek-v4-flash-latest`; see `.env.example` for both answer and resume model settings.

Reasoning is disabled. The model call has a 90-second ceiling, shortened to leave 20 seconds before the reported step deadline. Responses are validated, with one mechanical repair allowed. If a model request fails, the app can still submit when deterministic answers cover every required field. Missing required facts, verification codes, or rejected API credentials stop the application with an explanation. There is no fallback to another model family.

Sensitive fields never go to the answer model. Users choose whether to use an advertised decline option or leave sensitive questions unanswered. The app does not collect or infer demographic answers. Optional location, authorization, sponsorship, availability, and relocation facts may remain unanswered; a form requiring a missing fact cannot be completed automatically.

## Production mode

The top bar switches between **Sandbox** (fictional jobs on `sandbox.jobo.world`, the deployment's `JOBO_API_KEY`) and **Production**. Production asks for the visitor's own Jobo API key, shows a one-time warning that applications go to real employers, and then:

- Searches the live catalog with `GET /api/jobs` on the visitor's key, with `sources` limited to the ATSes Auto Apply can route to. That list comes from the public status API (`JOBO_STATUS_URL`) minus `jobosandbox`, with a built-in fallback. Search is billed per job returned, so results are cached in memory for five minutes per key and query, because the feed re-renders while an application runs. Job detail and saved jobs use `GET /api/jobs/{id}`, which is free.
- Creates applications with `job_id` on the visitor's key, so they belong to the visitor's Jobo account. The account needs Auto Apply enabled. Jobo checks that at create time, and the demo explains `auto_apply_not_enabled` and similar refusals.
- Stores the key AES-256-GCM sealed with `API_KEY_ENCRYPTION_SECRET` (`lib/secret-box.ts`), because the background worker needs it after the browser closes. Each queued application snapshots the sealed key, so a run finishes on the key it started with. The snapshot is cleared when the run is terminal. Disconnecting deletes the stored key.

Production mode is off unless `API_KEY_ENCRYPTION_SECRET` is set. Rotating that secret disconnects every stored key.

## Persistence and recovery

- Better Auth owns email/password accounts, verification, recovery, sessions, and authentication rate limits. Protected data actions check ownership.
- Postgres stores profiles, resume metadata, saved jobs, applications, and exchanges. PDF contents live in `DATA_DIR/resumes`.
- Every Apply click snapshots the reviewed profile and copies the PDF. Later edits do not change a running application. File downloads require ownership or an expiring application-specific signature.
- Workers claim work with renewable leases and coordinated concurrency caps: two applications globally and one per user by default. The browser displays progress but does not advance execution.
- Create idempotency keys are persisted before network calls, and answers before submission. Recovery reuses the existing attempt. Confirmed or uncertain submissions cannot be started again through ordinary retry.
- After six failed exchanges, the worker moves to cancellation/reconciliation if an upstream ID is known; otherwise it pauses for operator review. Create recovery stops after a conservative 20-hour window, before the API's 24-hour idempotency expiry. Unreconciled records stay blocked from duplicate submission.

The private API inspector captures up to 100 HTTP calls per application, shown as separate header and body code blocks with copy and copy-as-cURL; an oversized body is cut at 256K characters with a visible truncation label. Older records have no historical capture. An absent response is never evidence that submission did not happen. A failure-triggered cancellation is displayed as **Couldn’t Complete**; a user cancellation as **Canceled**.

## Deploy your own instance

Run the web process and background worker against one Postgres database and a shared persistent PDF directory. The repository includes a Dockerfile. Inject the environment variables above, apply migrations once before starting the new version, and use your own HTTPS origin for account links and resume downloads.

```sh
npm run build
node --env-file=.env.local --import tsx scripts/migrate.ts
# Run these as separate supervised processes with the same environment:
node --env-file=.env.local node_modules/next/dist/bin/next start
node --env-file=.env.local --import tsx scripts/worker.ts
```

The hosted deployment uses a single replica with shared local PDF storage. Do not scale web replicas without making the files available to every instance. If using a ReadWriteOnce volume, use a recreate deployment strategy. `npm run worker:health` checks the worker's database heartbeat when run with its environment.

Back up both Postgres and the PDF directory. Migrations are forward-only; restoring an older image does not undo schema changes. Verify signup, email delivery, resume access, a completed sandbox application, and worker restart recovery after deployment.

## Checks

```sh
npm run db:up
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Tests need Postgres. The default uses the Compose database; alternatively set `TEST_DATABASE_URL` to a Postgres login permitted to create databases. Tests create disposable databases. The browser suite starts an isolated test server with fixture responses and does not send real email, invoke OpenRouter, or submit real applications.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `403 auto_apply_not_enabled` | The account owning `JOBO_API_KEY` needs beta access |
| Applications stay queued | Worker is running and shares the web app's database and environment |
| Signup email does not arrive | Brevo credential, configured sender, and spam folder |
| Resume download fails | `PUBLIC_BASE_URL` reaches this instance over public HTTPS; web and worker share PDFs and signing secret |
| Profile cannot be used | Complete the required contact fields and final review |
| Application could not complete | Read the missing-answer explanation and redacted API exchanges; do not retry an uncertain submission blindly |
| Tests cannot connect to Postgres | Start `db:up`, or set `TEST_DATABASE_URL` with database-creation permission |

## Scope and contributing

This demo supports text-based PDFs and fictional sandbox jobs from [sandbox.jobo.world/api/jobs](https://sandbox.jobo.world/api/jobs). OCR, DOCX, real-employer jobs, bulk applications, billing, mailbox connections, and native mobile apps are outside its scope. The API supports optional mailbox verification separately from this demo.

This repository is a public mirror of `Jobo.Examples/auto-apply` in Jobo's main repository. Contributions are made upstream; direct mirror changes are overwritten by the next sync. Report problems through [GitHub issues](https://github.com/JoboAI/jobo-auto-apply-example/issues).

Licensed under [MIT](LICENSE).
