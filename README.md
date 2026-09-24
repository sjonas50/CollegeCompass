# College Compass

A low-cost, AI-assisted guidance counselor for students in grades 7–12 who can't pay for private
counseling or whose school counselor can't give them personal attention. See the
[v2 product spec](https://claude.ai/code/artifact/2baea690-7a5a-46c8-8265-f9d1f448aabd).

This is the v2 rebuild. The v1 prototype lives in `main`'s history.

## Getting started

Requires Node 24 (production and CI run 24; `engines` pins it for Vercel). Newer Node works for
development: from Node 25, `fetch` speaks HTTP/2, which hung the server on Node 26 when a request
was cancelled, so calls to Anthropic and Resend go through `outboundFetch` (HTTP/1.1 only).

```bash
npm install
npm run data:load   # optional: O*NET careers, CIP–SOC majors, College Scorecard colleges and programs (~45 MB download)
npm run dev
```

No database setup is needed locally: without `DATABASE_URL` the app uses an embedded Postgres
(PGlite) in `.data/pglite` and applies migrations on first request. Emails (like the parent
consent link) are printed to the dev server console. Copy `.env.example` to `.env.local` to
change settings.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Unit and integration tests (each test gets a fresh in-memory Postgres) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:generate` | Create a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (run in the deploy step) |
| `npm run data:load` | Download and load public reference data |
| `npm run data:check-scorecard` | Checks loaded college and program data against the live College Scorecard API for 12 test schools |
| `npm run check:matching` | Checks career matches for test students of every interest type against the real data |
| `npm run eval:safety` | Live eval of the safety classifier (calls the Anthropic API; costs money) |
| `npm run eval:counselor` | Live eval of the AI counselor (calls the Anthropic API; costs money) |
| `npm run admin:create` | Creates a staff account for `/admin` (see [The first admin](#8-the-first-admin)) |
| `npm run access:grant` | Gives a household comp or sponsored access, recorded with the staff account in `--by` (see "Giving a family access" in [`docs/operations.md`](docs/operations.md)) |

## Reference data

`npm run data:load` downloads public datasets into `.data/reference/` (kept between runs) and
replaces the reference tables in one transaction. Student tables never reference them with
foreign keys, so reloading never touches student data.

| Tables | Source |
| --- | --- |
| `occupations`, `occupation_interests` | [O*NET 31.0 Database](https://www.onetcenter.org/database.html) (CC BY 4.0) |
| `occupation_values` | O*NET 30.0 Work Values (the last release that has them) |
| `majors`, `cip_soc_links` | [NCES CIP 2020–SOC 2018 crosswalk](https://nces.ed.gov/ipeds/cipcode/resources.aspx?y=56) |
| `colleges` | [College Scorecard](https://collegescorecard.ed.gov/data/) institution data, U.S. Department of Education (June 2026 release) |
| `college_programs` | College Scorecard field-of-study data, U.S. Department of Education (June 2026 release) |

College Scorecard notes:

- We keep currently operating schools that mainly award certificates, associate, bachelor's or
  graduate degrees, and their undergraduate programs (certificate, associate, bachelor's) with
  median debt and median earnings four years after graduating. Programs use 4-digit CIP codes
  (`"11.07"`); the crosswalk's majors are 6-digit.
- The files mark missing values `NA` and privacy-suppressed values `PS` (too few students to
  publish). Both load as `null`, so the app shows a plain explanation instead of a number.
- Net price comes from the school's own sector columns (`_PUB` or `_PRIV`, which cover every
  calendar type), then the other sector's (for schools whose control changed), then the
  discontinued `_PROG`/`_OTHER` columns. Published net prices can be negative when grants exceed
  the cost; they're stored as published and shown as $0.
- `npm run data:check-scorecard` is the Phase 3 exit check: it compares the loaded data for 12 real
  schools (large public, small private, for-profit, community college, two program-year trade
  schools, HBCU, HSI, tribal, online-only, highly selective, and a school whose control changed)
  with the live [College Scorecard API](https://collegescorecard.ed.gov/data/api-documentation/).
  It uses `SCORECARD_API_KEY` (free at [api.data.gov](https://api.data.gov/signup/)) or the
  rate-limited `DEMO_KEY`, makes one request for all schools, and caches the response in `.data/`
  for a day.

## How it fits together

- `src/db/schema.ts` — all tables. Student data hangs off `users`/`households`; reference data
  (occupations, majors, colleges) is separate and read-only.
- `src/lib/accounts.ts`, `src/lib/consent/`, `src/lib/privacy.ts` — accounts, COPPA parental
  consent, and data export and deletion (by a parent, or by a teen for their own account). Written
  as plain functions taking a `Db`, so they're tested without a browser (`test/coppa-flow.test.ts`,
  `test/delete-own-account.test.ts`).
- `src/lib/auth/` — argon2id passwords, database sessions (hashed tokens, 14-day sliding), and
  the data-access layer (`requireUser`). `src/proxy.ts` only does optimistic redirects.
- `src/lib/ai/` — model config, cost tracking with a per-student monthly budget, PII scrubbing,
  and the two-tier safety classifier (`safety/`), with its eval set in `evals/safety/`.
- `src/lib/reference/` — parsers for O*NET, the NCES CIP–SOC crosswalk and College Scorecard
  (institutions and field of study).
- `src/lib/assessments/` — the three instruments (O*NET Interest Profiler Short Form, Mini-IPIP,
  a work-values ranking), deterministic scoring, and attempts with autosave and 90-day retakes.
- `src/lib/matching/` — career matching (interest-profile correlation, lightly adjusted by values,
  degree and training paths ranked separately) and the AI explanation with a template fallback.
  Attribution required by the O*NET licenses is in `src/components/attribution.tsx` and `/about/data`.

## Deploying to production

The app runs on Vercel with a managed Postgres database, Resend for email and (optionally)
Stripe for payments. Before real families sign up, work through
[`docs/pilot-checklist.md`](docs/pilot-checklist.md). Day-to-day running is in
[`docs/operations.md`](docs/operations.md).

`src/env.ts` checks the configuration on the first request. In production it refuses to start
without `DATABASE_URL`, `CRON_SECRET`, an `https://` `APP_URL`, a real email transport and sender
address, and a real consent verifier. A misconfigured deploy still builds, but every request fails,
and `/api/health` returns 503.

### 1. Database

Use a managed Postgres in a US region, close to where Vercel runs your functions. The simplest
choice is Neon from the Vercel Marketplace (Vercel project → **Storage** → **Create Database**),
which adds the connection strings to the project for you. Other providers work too.

- Create **separate databases for Production and Preview** (with Neon, a branch for previews).
  Preview deployments must never read or write real students' data.
- The app uses the pooled connection string as `DATABASE_URL`. Run migrations and data loads with
  the direct (unpooled) one; Neon's integration adds it as `DATABASE_URL_UNPOOLED`.
- The app uses prepared statements. Neon's pooler supports them. A transaction-mode pooler that
  doesn't (such as Supabase on port 6543) needs a session-mode or direct connection instead.
- Turn on point-in-time restore and note how many days it keeps. Deleted accounts stay in backups
  until that window passes; the privacy policy has to say so.

### 2. Vercel project

1. Import the repository into Vercel. The framework preset is Next.js; keep the default build
   command (`npm run build`). Vercel picks Node.js 24 from `engines` in `package.json`; check it
   under **Settings → Build and Deployment**.
2. Set the function region (**Settings → Functions**) to the one nearest your database, for example
   Washington, D.C. (`iad1`) for a database in `us-east-1`.
3. Add the environment variables below for **Production**. Give **Preview** its own values: the
   preview database, Stripe test keys, and a separate Resend key.
4. Turn on **Deployment Protection** (Vercel Authentication) so preview URLs aren't public.
5. Add your domain. Set `APP_URL` to it, with `https://`.

**Hobby or Pro?** The Hobby plan is enough for a free pilot. It has two limits that matter here:
cron jobs run at most once a day (see [Cron jobs](#5-cron-jobs)) and runtime logs are kept for one
hour. Vercel's Hobby plan is for non-commercial use only, and taking payments counts as
commercial, so move to Pro before you turn on Stripe checkout for real families.

### 3. Environment variables

"Required" means required in production. Anything not listed as required has a safe default.

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string (the pooled one on Vercel). Without it, local development uses the embedded PGlite database. |
| `APP_URL` | Yes | The site's public address, like `https://collegecompass.example.org`. Used in email links (consent, reminders). The default is `http://localhost:3000`, so a missing value sends broken links. |
| `CONSENT_VERIFIER` | Yes | How a parent's consent is verified for under-13 accounts. `dev_attestation` (the only value so far) is refused in production; a real method chosen with counsel must be added first. |
| `CONSENT_REQUEST_TTL_DAYS` | No | Days a parent consent link stays valid (default 7, 1–30). Expired requests and the parent's email are deleted by the daily sweep. |
| `EMAIL_TRANSPORT` | Yes | `resend` in production. `log` (the default) prints emails to the console and is refused in production. |
| `RESEND_API_KEY` | Yes, with Resend | A Resend API key with sending access only. |
| `EMAIL_FROM` | Yes | The sender: an address, alone or with a name, like `College Compass <hello@mail.example.org>`. Must use the domain you verified in Resend. Checked in every environment; with Resend, `localhost` and domains without a dot are refused. |
| `CRON_SECRET` | Yes | At least 16 random characters (`openssl rand -hex 32`). Vercel sends it with every cron call; the cron routes reject calls without it. |
| `ANTHROPIC_API_KEY` | Yes, for AI | Without it, safety screening uses the keyword rules only and the AI counselor and career explanations are off. |
| `AI_MODEL_SAFETY` | No | Model for the safety check (default `claude-opus-5`). Run the safety eval before changing it. |
| `AI_MODEL_SAFETY_BACKUP` | No | Model tried when the safety model errors (default `claude-sonnet-5`). If both fail, the keyword rules decide alone. |
| `AI_MODEL_COUNSELOR` | No | Model for the counselor and career explanations (default `claude-opus-5`). Run the counselor eval before changing it. |
| `AI_MONTHLY_BUDGET_USD` | No | Monthly AI spending limit per student, in dollars (default 3). Safety checks are never blocked by it. |
| `TRIAL_DAYS` | No | Length of every new household's free trial (default 14). |
| `FREE_ACCESS_MONTHS` | No | How long a free-access grant lasts before the family renews it (default 12). |
| `STRIPE_SECRET_KEY` | No | Turns on paid checkout. Without Stripe keys, families use the trial and free access only. |
| `STRIPE_WEBHOOK_SECRET` | With Stripe | Signing secret of the webhook endpoint (`whsec_...`). On your computer, use the one `stripe listen` prints (see [Payments](#7-payments-stripe)). |
| `STRIPE_PRICE_MONTHLY` | With Stripe | Price id (`price_...`) of the monthly family plan. |
| `STRIPE_PRICE_ANNUAL` | No | Price id of the annual family plan. |
| `NODE_ENV` | Set by Vercel | `production` on Vercel (previews too), which turns on the checks above. |
| `PGLITE_DATA_DIR` | No | Local development only: where PGlite keeps its data (default `.data/pglite`). |
| `SCORECARD_API_KEY` | No | Scripts only: api.data.gov key for `npm run data:check-scorecard` (uses `DEMO_KEY` without it). |
| `EVAL_JUDGE_MODEL` | No | Scripts only: the judge model for `npm run eval:counselor` (default `claude-opus-5`). |

Keep secrets in Vercel's environment settings only. To run a script against production, paste the
value into the one command (as below) instead of saving it in a file on your computer.

### 4. Migrations and reference data

Migrations are not applied automatically in production. Apply them before the first deploy and
before each deploy that includes a new file in `drizzle/`. Write migrations that only add things
(new tables, new nullable columns), so the version that is still running keeps working until the
new one is live.

```bash
# Use the direct (unpooled) connection string for these.
DATABASE_URL="postgres://..." npm run db:migrate

# First deploy, and each time a new data release is loaded (downloads ~45 MB; needs `unzip`):
DATABASE_URL="postgres://..." npm run data:load
DATABASE_URL="postgres://..." npm run data:check-scorecard   # must pass: our numbers match the live API
```

`data:load` replaces only the reference tables (careers, majors, colleges) in one transaction.
Student data is never touched. Do the same for the Preview database.

### 5. Cron jobs

`vercel.json` schedules two jobs. Vercel runs them on production deployments only, sending
`Authorization: Bearer $CRON_SECRET`.

| Route | Schedule (UTC) | What it does |
| --- | --- | --- |
| `/api/cron/sweep` | Daily, 09:00 | Deletes expired parent consent requests (and the parent's email with them), expired sessions, old rate-limit rows, and Stripe event ids older than 30 days. Retries Stripe clean-up that failed earlier and closes Stripe customers of households whose last parent left, once their plan has ended (see "Stripe clean-up" in [`docs/operations.md`](docs/operations.md)). |
| `/api/cron/weekly-reminders` | Mondays, 13:00 | Sends each student (or a younger student's parent) a weekly look back and ahead. |

**Hobby vs Pro.** Hobby allows one run a day per job and may start it any time within the hour.
Hobby also caps a function at 60 seconds, so the weekly reminders get one short run a week: it
stops starting new emails after 25 seconds (a few dozen reminders), and anything that didn't go
out (including failed sends) waits until you run the job again by hand. Each manual run sends the
next batch. That is enough for a pilot of 10–20 families; the Monday check in
[`docs/operations.md`](docs/operations.md) does the re-run. On Pro, raise `maxDuration` to 300 and
`BUDGET_MS` to 240 seconds in `src/app/api/cron/weekly-reminders/route.ts`, and change the
schedule to hourly on Mondays (`"0 13-18 * * 1"`), so later runs finish a big week and retry
failures.

Re-runs never send a reminder twice. Each one is claimed in the database before it's sent, and
Resend gets the same idempotency key for it on every run, so even an email whose answer got lost
goes out once. (Resend remembers keys for 24 hours, so re-run the same day.)

To run a job by hand (for example after an outage):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/sweep
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/weekly-reminders
```

The reminders job answers with its counts, `{ sent, skipped, failed, uncertain, more }`, and logs
the same counts in one line, like `[reminders] run sent=12 skipped=0 failed=0 uncertain=0 more=false`
(a warning when something is left to send). It never logs addresses.

### 6. Email (Resend)

1. Create a Resend account. Add a sending **subdomain**, like `mail.example.org`, so email
   reputation stays separate from your main domain. Pick a US region.
2. Add the DNS records Resend shows you (DKIM and SPF: `TXT` and `MX` records), copied exactly.
   Verification often takes about 15 minutes and can take up to 72 hours.
3. Add a DMARC record at `_dmarc.example.org`. Start with
   `v=DMARC1; p=none; rua=mailto:dmarc@example.org;` and tighten it to `quarantine` once reports
   show your mail passing.
4. **Keep open tracking and click tracking off** (they're settings on the domain). Our emails go
   to parents and teens, and click tracking would send private links (like consent links) through
   a tracking server.
5. Create an API key with **sending access** for this domain only. Set `EMAIL_TRANSPORT=resend`,
   `RESEND_API_KEY` and `EMAIL_FROM`.
6. Send yourself a test: request parent consent on the site with your own address.

How sending works (`src/lib/email.ts`):

- **Pace.** Resend allows 10 requests a second per team. Every request from a server waits its
  turn so that at most 8 start each second, which leaves room for another server sending at the
  same moment. The weekly reminders go through the same line.
- **Retries.** Each email gets up to 3 tries, all with the same idempotency key, so Resend never
  sends it twice. Each try times out after 10 seconds. A server error, timeout or network error is
  tried again after a second. A rate limit (`429`) is tried again after the wait Resend asks for.
  If Resend says it's still working on the same email (`409 concurrent_idempotent_requests`,
  which follows a timeout), we wait 3 seconds and ask again, and Resend answers with the first
  try's result. Other errors (a bad address, a bad key, a used-up quota) fail right away.
- **Uncertain sends.** When no try gets a clear answer (they time out, or Resend is still working
  on it), the email may still arrive. Parent consent links and parent invitations then stay valid
  (they expire on their own), and the student is told the email may take a few minutes. Weekly
  reminders count it as `uncertain`, and a re-run the same day is safe.
- **Logs.** Failures are logged as `[email] resend send failed: status=... code=...` (or
  `resend send uncertain`), never with the recipient, subject or body.

### 7. Payments (Stripe)

Set this up in test mode first (test keys for Preview), then again in live mode for Production.

1. **Product and prices.** Create one product, "College Compass family plan", with a monthly and
   an annual recurring price. Put their ids in `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL`.
2. **Webhook.** In the Stripe Dashboard's Webhooks page, add an endpoint at
   `https://YOUR_DOMAIN/api/stripe/webhook`, with API version `2026-08-26.dahlia` (the version
   the installed `stripe` package uses). Send these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

   (Payment failures arrive as `customer.subscription.updated` with status `past_due`, which keeps
   access while Stripe retries; the handler answers 200 to any other event.)

   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. Stripe retries failed deliveries for up to
   three days; the app records each event id, so a repeat is ignored.
3. **Customer portal** (Settings → Billing → Customer portal): allow updating the payment method,
   viewing invoices, switching between the monthly and annual price, and canceling at the end of
   the billing period. Turn off quantity changes. Add your privacy policy and terms links, and set
   the default return link to `https://YOUR_DOMAIN/account`.
4. Set the statement descriptor to something parents will recognize, like `COLLEGE COMPASS`.
5. **Test on your computer** with the Stripe CLI and test-mode keys. (Events made up by
   `stripe trigger` don't belong to a household, so the app ignores them. Use a real test-mode
   Checkout instead.)
   1. In `.env.local`, set `STRIPE_SECRET_KEY` (`sk_test_...`) and `STRIPE_PRICE_MONTHLY` (a
      test-mode price).
   2. Run `stripe login` once, then leave this running:
      `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
      It prints a signing secret (`whsec_...`). Put that one in `STRIPE_WEBHOOK_SECRET` in
      `.env.local` (not the Dashboard endpoint's secret: that one only works for events sent to
      the endpoint), then restart `npm run dev`.
   3. Sign up as a parent, open **Plan and billing** (`/account/billing`), choose a plan, and pay
      with the test card `4242 4242 4242 4242` (any future date, any CVC, any ZIP).
   4. The `stripe listen` window should show each event answered with `[200]`. A `[400]` means
      `STRIPE_WEBHOOK_SECRET` isn't the secret `stripe listen` printed.
   5. **Plan and billing** shows the plan as active. To check a change that only the webhook
      brings, choose **Manage billing**, cancel the plan, go back, and refresh: the page should
      say the plan is set to end.

For each household we keep Stripe's customer and subscription ids, the plan and its status, and
which parent pays. Card details stay with Stripe.

### 8. The first admin

Staff accounts (for the safety review queue and cost dashboard at `/admin`) are made from the
command line, never through sign-up:

```bash
DATABASE_URL="postgres://..." npm run admin:create
```

See the script's header for its options. Create one account per person, and remove accounts when
someone leaves.

### 9. After each deploy

1. `curl https://YOUR_DOMAIN/api/health` should return `{"ok":true}`. It returns `{"ok":false}`
   with status 503 when the database can't be reached in 5 seconds or the configuration is invalid.
   Point an uptime monitor at it (every 1–5 minutes).
2. Sign in as a test family and open the dashboard, the counselor and the parent page.
3. Check the logs for `[safety]`, `[email]` and `[reminders]` errors.

### Security headers

`next.config.ts` sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that turns off the
camera, microphone, location and ad-interest tracking, and, in production only,
`Strict-Transport-Security` for two years. Don't submit the domain to the HSTS preload list
unless every subdomain serves HTTPS.

**Follow-up: a Content-Security-Policy.** There is none yet, because a strict policy needs a fresh
nonce per request for Next's inline scripts (see Next's
`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`), which makes every page
dynamic. The plan: ship it first as `Content-Security-Policy-Report-Only`, set from `src/proxy.ts`
with a nonce, starting from:

```
default-src 'self'; script-src 'self' 'nonce-{NONCE}' 'strict-dynamic'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self';
form-action 'self' https://checkout.stripe.com https://billing.stripe.com; frame-ancestors 'none';
upgrade-insecure-requests
```

(`form-action` must allow Stripe's pages, since checkout and the customer portal are redirects
after a form post.) Watch the reports for a week, then enforce it.

## Operations

- [`docs/operations.md`](docs/operations.md): daily and weekly routines (safety review queue,
  weekly reminders, AI costs, evals), yearly updates (reference data, the aid guide, key dates),
  giving a family comp or sponsored access, and what to do in an incident (AI outage, budget
  limits, email failures).
- [`docs/pilot-checklist.md`](docs/pilot-checklist.md): what has to be true before the pilot
  starts, and how to bring on the first 10–20 families.

### Before changing prompts or models

Run both evals with the models you plan to use. They call the Anthropic API and cost money. Run
them on your computer against a local database with reference data loaded, never against
production.

```bash
npm run data:load            # once; the counselor eval's career tools need it
npm run eval:safety          # must exit 0: no high or imminent case rated lower
npm run eval:counselor       # must exit 0: at least 90% of cases pass
AI_MODEL_SAFETY=... npm run eval:safety      # try a different model before switching
```

Change `AI_MODEL_*` in Vercel only after both pass, and write down the results (date, models,
scores) in the pull request.

## Before real students use this

The full go/no-go list is [`docs/pilot-checklist.md`](docs/pilot-checklist.md). These block
production outright (`src/env.ts` refuses to start until they're configured):

- **Verifiable parental consent.** `CONSENT_VERIFIER=dev_attestation` is a click-through
  stand-in, not COPPA-compliant consent. Choose a real method with counsel.
- **Email provider.** Set up Resend (above); the console "log" transport is refused.

And these need sign-off before launch:

- **Privacy policy.** `/privacy` is a plain-language draft pending legal review.
- **Anthropic usage policy.** Confirm the product meets Anthropic's requirements for
  minor-facing apps before shipping AI features to students.
