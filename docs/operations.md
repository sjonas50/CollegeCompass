# Operations

How to run College Compass day to day, and what to do when something breaks. Setup is in the
README under [Deploying to production](../README.md#deploying-to-production); the launch list is
[pilot-checklist.md](pilot-checklist.md).

These rules apply to everything here:

- **Keep personal data out of notes, tickets, chat and commits.** Refer to a family by an account
  id from `/admin`, never by name, email or message text.
- **Staff pages live at `/admin`.** Only named people have staff accounts
  (`npm run admin:create`).
- **Look up contact details only when you need them.** To reach a parent after a safety event,
  use the reveal on that event's page in `/admin`: it shows who the student is and how to reach
  their linked parent, and every reveal is recorded in the audit log. If no parent is linked (a
  teen who signed up alone), it says so; follow the parent-notification policy for that case.

## Every weekday (about 15 minutes)

1. **Safety review queue** (`/admin/safety`, or "Open the queue" on `/admin`). Start at the top:
   the most severe events come first, and the longest waiting first within each level. The review
   targets are at the top of the page (imminent and high within 24 hours, medium within 3 days),
   and late events have an "Overdue" badge. For each event:
   - **Open it.** The page shows what the student wrote, the details, and the event's **family
     reference** (`H-` and 8 characters). Opening an event is logged.
   - **Check "AI model tier".** "Didn't run" means keyword rules alone rated the message, because
     the AI model was unavailable, the student was sending messages very fast, or the counselor
     was locked. The queue row says the same thing ("...: keyword rules alone decided"). The
     rating may be off in either direction, so read these with extra care. "Not asked" means the
     rules found a clear high-risk phrase; check whether it's even more urgent than rated.
   - **Only if you need it, "Show conversation context".** It shows the student's first name,
     whether a parent manages the account, and the messages around this one. If the event isn't
     linked to a conversation, the page shows its best guess, labeled "Likely match". Don't treat
     a best guess as the flagged message. Messages sent while the counselor was locked were never
     saved, so there's nothing to show.
   - **To reach a parent, "Show parent contact".** It shows each linked parent's email, or says no
     parent is linked. Follow the parent-notification policy the lawyer signed off.
   - Each time you show the context or the parent contact, it's logged.
   - **Record what you did:** no action needed, followed up, or escalated. A note is needed
     unless no action was needed. In the note, refer to the family by its reference (for example
     `H-1a2b3c4d`), never by name or email. The first review saved stands; the page tells a second
     reviewer someone already did it.

   The monthly numbers are on the AI costs page (`/admin/costs`), under "Safety reviews". When a
   family deletes their account, events someone already reviewed stay in those numbers; events
   nobody reviewed yet are deleted with the account and drop out.
2. **Alerts.** Check the uptime monitor (`/api/health`) and the error-monitoring service. Anything
   new gets looked at today.
3. **Logs.** Search the Vercel logs for `[safety]`, `[email]` and `[reminders]`. A few
   `[safety] ... model failed` lines are normal (the backup model takes over); many in a row mean
   an AI outage (see below).
4. **Support inbox.** Reply within one business day.

Vercel keeps runtime logs for one hour on Hobby and one day on Pro, so rely on the
error-monitoring service for anything older.

## Every week

- **Monday afternoon (after 14:30 UTC): weekly reminders.** The scheduled run's log line is
  gone within the hour on Hobby, so check by running the job again by hand. A re-run sends only
  what the scheduled run didn't, and never sends a reminder twice:

  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/weekly-reminders
  ```

  It answers with counts, `{ sent, skipped, failed, uncertain, more }`:

  - `skipped`: reminders that already went out. If this run `sent` any, the scheduled run missed
    them (it didn't run, ran out of time, or a send failed). They've gone out now.
  - `failed` above 0: fix the cause (see "Email failures"), then run it again.
  - `uncertain` above 0: Resend took those emails but answered too late. Run it again in a few
    minutes. Resend recognizes each reminder and never sends it twice within 24 hours, so re-run
    the same day.
  - `more: true`: time ran out. Run it again.

  Every run also logs one line with the same counts, like
  `[reminders] run sent=12 skipped=0 failed=0 uncertain=0 more=false` (a warning when something
  is left). On Pro, where logs last a day, you can read the scheduled runs' lines instead.

- **Cost dashboard** (`/admin`). Look at this month's AI spend per student and in total. Look into
  any student near `AI_MONTHLY_BUDGET_USD` and any sudden jump. Compare the total with the
  Anthropic Console's usage page.
- **Stripe** (only if families pay): failed payments, disputes, and failing webhook deliveries.
- **Daily sweep.** Logs don't last a week, so check what the sweep leaves behind. In the database
  provider's SQL editor, both of these should return 0 (counts only, no personal data):

  ```sql
  select count(*) from consent_requests where expires_at < now() - interval '2 days';
  select count(*) from sessions where expires_at < now() - interval '2 days';
  ```

  Anything above 0 means the sweep hasn't run for over a day: see "A cron job didn't run", then
  run it by hand.

## Every month

- **Run the evals** (`npm run eval:safety`, `npm run eval:counselor`; see the README) with the
  production models, even if nothing changed. Check Anthropic's model deprecation notices; plan a
  switch, with a passing eval, well before a model is retired.
- **Always run both evals before changing a prompt or a model**, and put the results in the pull
  request. The safety eval must exit 0 (no high or imminent case rated lower); the counselor eval
  needs at least 90% of cases passing.
- **Staff accounts.** Remove anyone who no longer needs access.
- **Dependencies.** Review security updates (`npm audit`), update, and let CI run.

## Every quarter

- **Test a restore.** Restore the production database to a new database (or branch), point a
  preview deployment at it, sign in with a test account, then delete the copy. Write down how
  long it took.
- **Rotate secrets** if anyone with access has left: `CRON_SECRET`, `RESEND_API_KEY`,
  `ANTHROPIC_API_KEY`, and Stripe keys (roll them in Stripe's dashboard). Change the value in
  Vercel, then redeploy.

## Every year

- **Reference data refresh.** O*NET and the College Scorecard publish new releases about once a
  year.
  1. Update the file URLs in `scripts/load-reference.ts`, and `SCORECARD_RELEASE` in
     `src/lib/colleges/describe.ts`.
  2. Locally: `npm run data:load`, `npm test`, `npm run check:matching`,
     `npm run data:check-scorecard`.
  3. Deploy, then load production: `DATABASE_URL="..." npm run data:load` and
     `DATABASE_URL="..." npm run data:check-scorecard`. Student data isn't touched.
- **Financial aid guide, before each FAFSA season** (the FAFSA opens around October 1):
  1. Re-check every date and dollar amount in `src/content/aid-guide/en.json` against
     studentaid.gov, fix what changed, and update `updated`.
  2. Set `review.status` back to `"draft"`: changed sections no longer match the reviewed
     `contentFingerprint`, and the checks fail until you do. The page shows its draft notice again.
  3. A counselor reviews the exact new content. Then set `review.status` to
     `"counselor-reviewed"` with `reviewedBy`, `reviewedOn` and the `contentFingerprint` the
     check prints (`npx vitest run src/lib/aid-guide src/app/aid`).
  4. Walk through the new FAFSA once with the guide open.
- **Key dates.** When Federal Student Aid and the College Board confirm the next cycle's dates,
  add them to `VERIFIED_FAFSA` and `VERIFIED_CSS` in `src/lib/applications/key-dates.ts`.
- **Policies.** Re-read the privacy policy, the parent-notification policy and the vendor data
  agreements with the lawyer.

## As needed

### Giving a family access (comp or sponsored)

Families get full access from a plan, the trial or free access on their own. Staff can also give a
household access for a set time, for example pilot families for the whole pilot:

```bash
DATABASE_URL="postgres://..." npm run access:grant -- --household <household id> --kind comp --until 2027-06-30
```

Use `--kind comp` for access we give ourselves and `--kind sponsored` for a seat someone else
pays for. `--until` is the date access ends. See the script's header for how to find a
family's household id and for its other options. Don't write the family's name next to the id in
notes or tickets.

## Incidents

For any incident: (1) find out who is affected and since when, (2) stop the harm, (3) fix the
cause, (4) write a short note of what happened and what changed, with no personal data in it.

### AI outage (Anthropic errors or down)

**What the app does on its own:**

- **Safety still runs.** Each message is checked by the safety model, then the backup model, then
  the keyword rules alone if both models fail. Clear high-risk phrasings still get crisis
  resources right away. Concerning messages are still saved to the review queue, marked
  `model_unavailable`.
- **The counselor pauses.** Students see: "The counselor isn't available right now. Please try
  again a little later." Career explanations fall back to a template. The rest of the app works.

**What you do:**

1. Check status.anthropic.com and the `[safety]` log lines to confirm.
2. Review every `model_unavailable` event as soon as you can. The keyword rules miss subtle
   messages, and a message the rules didn't flag at all is not in the queue, so there is no way
   to review those later.
3. If it lasts more than a day, tell families by email that the counselor is paused.
4. Nothing to switch back afterward: the next message uses the models again.

If the outage is only one model (for example it was retired), set `AI_MODEL_SAFETY` or
`AI_MODEL_COUNSELOR` to a model that passed the evals and redeploy.

### AI budget reached

- **One student over `AI_MONTHLY_BUDGET_USD`:** the student sees "You've used this month's
  counselor chats. They'll be back next month." Everything else still works, and safety checks
  are never blocked. Usually nothing to do. Check the cost dashboard for anything unusual (very
  long chats, repeated messages).
- **Many students hitting it, or spend jumps:** look for a cause before raising the limit (a
  prompt change that made replies longer, a model or price change, misuse). To raise it, change
  `AI_MONTHLY_BUDGET_USD` in Vercel and redeploy.
- **The Anthropic account's own spend limit reached:** every AI call fails, which looks like an
  AI outage (above). Raise the limit in the Anthropic Console and find out why spend grew.

### Email failures

Failures are logged as `[email] resend send failed: status=... code=...`, or
`[email] resend send uncertain: ...` when the email may still arrive. They never include the
recipient or the email text. A line ending in `; retrying` is a try that's being repeated, not a
failure yet. What the codes mean:

| Log shows | What it means | What to do |
| --- | --- | --- |
| `status=401` or `403`, `missing_api_key`, `restricted_api_key`, `invalid_permission` | The API key is wrong, revoked or can't send from this domain | Make a new sending key in Resend, update `RESEND_API_KEY`, redeploy |
| `status=403`, `validation_error` about the domain | The sending domain isn't verified | Check the DNS records in Resend and `EMAIL_FROM` |
| `status=422` or `validation_error` for one email | One bad address | Usually nothing; a family may have mistyped an email |
| `daily_quota_exceeded`, `monthly_quota_exceeded` or `email_above_quota` | Plan quota used up | Upgrade the Resend plan, then re-run what failed |
| `status=429`, `rate_limit_exceeded` (after retries) | Too many sends per second, even after waiting as Resend asked. Usually another app or script sending with the same Resend team | Re-run the job later; tell a developer if it repeats |
| `status=5xx` or `network_error` (after 3 tries) | Resend or the network had a problem | Check resend.com's status page; re-run later |
| `resend send uncertain` (`timeout` or `concurrent_idempotent_requests`) | Resend took the email but didn't answer in time. It may still arrive | Nothing, unless it repeats. Consent links and invitations keep working; for reminders, re-run the job the same day |
| `status=409`, `invalid_idempotent_request` | A re-run found a weekly reminder that Resend already took in the last 24 hours, and its text has changed since | Nothing: it counts as sent |

**Re-sending what failed:**

- **Weekly reminders:** a failed or uncertain send is released, so running the job again by hand
  sends only what didn't go out (command above). Re-run the same day, while Resend still
  recognizes each reminder.
- **Parent consent emails:** the student (or parent) asks again from the same page. The limit is
  3 requests per parent email a day. After an uncertain send the first link still works, so ask
  the parent to check their spam folder first.
- **Parent invitations:** the student cancels the invitation on their dashboard and sends a new
  one (up to 5 a day, 3 waiting at once).

If email is down for more than a few hours during a weekday, add a note to the support inbox's
auto-reply.

### The site is down (`/api/health` returns 503)

1. Check the Vercel deployment and its logs. After a deploy, an invalid environment variable makes
   every request fail: fix the variable, or roll back (Vercel → Deployments → Instant Rollback).
2. Check the database provider's status page and connection limits.
3. If data is damaged or lost, restore to a point in time before the problem (the quarterly
   restore test is the rehearsal).

### A cron job didn't run

Check Vercel → Settings → Cron Jobs. **View Logs** next to a job shows its recent runs and their
status (logs last one hour on Hobby and one day on Pro). On Hobby a job can start any time within
its hour. Run it by hand with the `curl` command above. A `401` means `CRON_SECRET` in Vercel doesn't
match what you sent.

### Stripe webhook failures

Stripe's dashboard shows failing deliveries and retries them for up to three days. Fix the cause
(often a wrong `STRIPE_WEBHOOK_SECRET` after rolling keys), then resend the failed events from the
dashboard. Repeats are safe: each event is handled once.

### Possible data exposure

If personal data may have reached someone it shouldn't (a wrong email, a leaked key, data in logs,
a lost laptop):

1. Contain it: rotate the affected keys, turn off the feature, or take the site down if needed.
2. Keep the evidence (don't delete logs) and write down what you know and when you learned it.
3. Call the lawyer the same day. They decide whether and how families and regulators must be
   told. Don't contact families about it before that conversation.
