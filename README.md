# College Compass

A low-cost, AI-assisted guidance counselor for students in grades 7–12 who can't pay for private
counseling or whose school counselor can't give them personal attention. See the
[v2 product spec](https://claude.ai/code/artifact/2baea690-7a5a-46c8-8265-f9d1f448aabd).

This is the v2 rebuild. The v1 prototype lives in `main`'s history.

## Getting started

Requires Node 24+.

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
  consent, and parent export/deletion. Written as plain functions taking a `Db`, so they're
  tested without a browser (`test/coppa-flow.test.ts`).
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

## Before real students use this

These are deliberately unfinished and block production (`src/env.ts` refuses to start in
production until they're configured):

- **Verifiable parental consent.** `CONSENT_VERIFIER=dev_attestation` is a click-through
  stand-in, not COPPA-compliant consent. Choose a real method with counsel.
- **Email provider.** Only the console "log" transport exists.
- **Privacy policy.** `/privacy` is a plain-language draft pending legal review.
- **Anthropic usage policy.** Confirm the product meets Anthropic's requirements for
  minor-facing apps before shipping AI features to students.
