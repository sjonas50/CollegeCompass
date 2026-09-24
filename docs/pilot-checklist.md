# Pilot go/no-go checklist

The pilot is 10–20 real families, starting after the privacy lawyer signs off. Every box must be
checked, or waived in writing with a reason, before the first real family signs up. Write the
date and who checked it next to each item. Keep personal details of families out of this file.

Setup steps are in the README under [Deploying to production](../README.md#deploying-to-production).
Routines and incident steps are in [operations.md](operations.md).

**Go/no-go meeting:** date ______ · decision ______ · people present ______

## 1. Legal and policy

- [ ] **Privacy lawyer sign-off**, in writing, on:
  - [ ] The privacy policy (`/privacy`, now a draft) and the terms of use.
  - [ ] The verifiable parental consent method for children under 13 (COPPA).
  - [ ] The **parent-notification policy for safety events**: when a student's message is rated
        high or imminent, who reviews it, whether and how a parent is told (for under-13s and
        for teens), and what staff do if a child may be in danger right now.
  - [ ] How long data is kept, including backups (deleted accounts stay in backups until the
        restore window passes).
  - [ ] The service providers that handle family data: Vercel, the database provider, Resend,
        Anthropic, Stripe and the error-monitoring service. Data processing agreements signed.
  - [ ] Any state student-privacy law that applies to the families you recruit.
- [ ] **Anthropic usage policy**: confirmed the product meets Anthropic's requirements for apps
      used by minors.
- [ ] The final privacy policy is published at `/privacy` and linked from sign-up and the parent
      pages. The "draft" wording is gone.

## 2. Parental consent

- [ ] A **real consent verifier** is built and configured (`CONSENT_VERIFIER`). Production won't
      start with `dev_attestation`.
- [ ] Tested end to end on production with a real parent: an under-13 student asks, the parent
      gets the email, verifies, and creates the child's account. The request and the parent's
      email are deleted if nobody responds (daily sweep).

## 3. Content

- [ ] **Financial aid guide reviewed by a counselor**, and the review recorded in
      `src/content/aid-guide/en.json` (`review.status: "counselor-reviewed"`, `reviewedBy`,
      `reviewedOn`, `contentFingerprint`). The page no longer shows the draft notice. The Spanish guide can stay a draft
      for the pilot; it keeps its draft notice.
- [ ] **FAFSA walkthrough done**: someone followed the guide step by step on the live 2027–28
      FAFSA (open since Sept. 23, 2026) and fixed anything that didn't match.
- [ ] **Key dates** for this school year confirmed in `src/lib/applications/key-dates.ts`
      (`VERIFIED_FAFSA`, `VERIFIED_CSS`).
- [ ] Reference data loaded in production and `npm run data:check-scorecard` passes against it.

## 4. AI safety

- [ ] **Safety eval passes on the production models**: `npm run eval:safety` exits 0 with the same
      `AI_MODEL_SAFETY` as production, and again with `AI_MODEL_SAFETY=<the backup model>`.
      Date, models and results recorded: ______
- [ ] **Counselor eval passes on the production model**: `npm run eval:counselor` exits 0 (at
      least 90% of cases). Date, model and result recorded: ______
- [ ] **Safety review owner** named: primary ______, backup ______ (covers weekends and time off).
- [ ] **Target review times** agreed and written into the parent-notification policy. Proposed:
  - Imminent: reviewed within 1 hour, 7 a.m.–10 p.m. local time, every day; first thing the next
    morning otherwise.
  - High: the same day.
  - Medium: within 2 business days.

  Students always see crisis resources right away for high and imminent messages; staff review
  is the follow-up, not the emergency response.
- [ ] **Safety drill**: a test student account (linked to a test parent) sends a clearly
      high-risk test message on production. It shows crisis resources, appears in the review
      queue at `/admin`, and the reviewer records an outcome. The reviewer also finds the parent's
      contact the way they would for real: the reveal on the event's page in `/admin`, which is
      recorded in the audit log. Timed against the targets above.
- [ ] Spending limits set: `AI_MONTHLY_BUDGET_USD` per student, and a monthly spend limit on the
      Anthropic account (Anthropic Console → Limits) with an email alert.

## 5. Email

- [ ] **Sending domain verified** in Resend (DKIM and SPF passing), DMARC record added, open and
      click tracking off.
- [ ] `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` (sending access only) and `EMAIL_FROM` set in
      Production.
- [ ] A consent email, a parent invitation and a weekly reminder arrive in Gmail, Outlook and
      iCloud inboxes, not spam, and every link in them works (they use `APP_URL`).
- [ ] **Support email** set up (like `help@` your domain), checked every weekday by a named
      person, and shown on `/privacy` and in the emails. Reply target: 1 business day.

## 6. Payments

- [ ] Decide: is the pilot free? If so, leave `STRIPE_SECRET_KEY` unset. Families get the trial
      and then free access, or comp access that staff grant with `npm run access:grant` (see
      "Giving a family access" in operations.md).
- [ ] If families pay during the pilot:
  - [ ] **Stripe prices set** (`STRIPE_PRICE_MONTHLY`, and `STRIPE_PRICE_ANNUAL` if offered).
  - [ ] Webhook endpoint `/api/stripe/webhook` added with the events in the README; Stripe shows
        successful deliveries.
  - [ ] Customer portal configured (payment method, invoices, switch plan, cancel at period end).
  - [ ] A real purchase, plan switch and cancellation tested in live mode, then refunded.
  - [ ] **Vercel is on Pro.** Hobby is for non-commercial use only.
- [ ] The free-access path works without questions or documents, and nothing in the app blocks
      a student over price.

## 7. Infrastructure

- [ ] Every production environment variable is set (README table). `APP_URL` is the real
      `https://` address.
- [ ] Preview deployments use their own database and Stripe test keys, and are behind Deployment
      Protection.
- [ ] Migrations applied (`npm run db:migrate`) to production.
- [ ] Both cron jobs appear under Vercel → Settings → Cron Jobs, and each has run once with
      status 200: **View Logs** next to the job shows its runs (Hobby keeps logs for one hour, so
      look within the hour after it runs), or run it by hand with the `curl` commands in the
      README and check the answer.
- [ ] **Backups on, and a restore tested**: point-in-time restore is on; we restored to a new
      database (or branch), pointed a preview deployment at it, signed in as a test account, and
      saw the right data. Restore window: ______ days. Time it took: ______.
- [ ] **Error monitoring** in place: server errors reach a named person within minutes. The
      service is set to collect no personal data (no request bodies, cookies, IP addresses or
      session replay). A test error arrived.
- [ ] **Uptime monitor** checks `/api/health` every 1–5 minutes and alerts the same person.
- [ ] First staff account created with `npm run admin:create`. Only named people have staff
      accounts.
- [ ] CI is green on the commit that's deployed.

## 8. Privacy in practice

- [ ] **Export tested**, with test accounts:
  - [ ] A parent downloads the export of a child they set up (under 13): it has everything the
        child has entered (assessments, plans, lists, counselor chats, and so on).
  - [ ] A parent downloads a linked teen's export: it leaves out counselor conversations, memory
        notes, safety events and counselor usage, and its `notIncluded` note says so.
  - [ ] A teen downloads their own export ("Download my data" in Settings on the dashboard): it's
        complete.
- [ ] **Deletion tested end to end** on production with test accounts:
  - [ ] A parent deletes one child: the child can't sign in, and their rows are gone (check the
        tables with a query).
  - [ ] A parent deletes the whole household account: parent, children, sessions, consent
        records and billing records are gone, any Stripe subscription is canceled, and no more
        emails go out.
  - [ ] A teen (13+) deletes their own account ("Delete my account" in Settings on the dashboard,
        confirmed with their password): they're signed out, can't sign in again, and their rows
        are gone. If they were alone in their household, it's gone too; a linked parent keeps
        their account. A child a parent set up under 13 is told to ask that parent instead.
  - [ ] The audit log keeps only what happened, with no names, emails or message text.
- [ ] **Logs checked**: after a full test session (sign-up, assessments, a counselor chat, a
      safety test message, a consent email), the Vercel logs and the error-monitoring service
      contain no names, emails, birthdays or message text.

## 9. Recruiting and onboarding the families

**Who.** 10–20 families with students across grades 7–12, including:

- A few students under 13, so the consent flow gets real use.
- A few families who will use free access.
- Students who mostly use a phone.
- At least a few students without much help from a school counselor.

**How to recruit.** Always go through parents, never directly to students. Good places: people
you know, a school counselor or community group willing to pass along a flyer, a library or youth
program. Keep a private list of contacts outside the app and outside git, and delete it after the
pilot.

**Steps:**

1. [ ] Write a one-page invitation for parents, in plain words: what College Compass is, what data
       it keeps, that an AI answers questions and never gets names or emails, that staff review
       worrying messages and what happens then, how to delete everything, and what we ask of
       them (use it most weeks for 6–8 weeks, answer two short surveys, one 20-minute call).
       Lawyer approves it, along with any thank-you gift.
2. [ ] Send invitations in small waves (5 families at a time), so problems show up early.
3. [ ] Each family: the parent signs up first. Under-13 students are added by the parent. Teens
       13 and up sign up themselves and link a parent.
4. [ ] Give pilot families access for the whole pilot, so price never comes up: comp access
       until the pilot ends
       (`npm run access:grant -- --by <your staff email> --household <household id, or a student's email or username> --kind comp --until <date>`;
       see "Giving a family access" in operations.md), or the trial then free access.
5. [ ] Offer a 15-minute welcome call: sign in together, start the interest assessment, and
       show the parent the parent page, the export and the delete button.
6. [ ] Week 1: short check-in message. Week 4: survey. End: survey and a call.
7. [ ] Track only what the app already records (accounts active each week, assessments finished,
       counselor chats, plan steps done). No extra tracking tools.
8. [ ] End of pilot: tell families what happens next (keep using it, and on what terms, or delete
       their data), and delete accounts for anyone who asks.

**Stop and fix** (pause new sign-ups, tell the lawyer if data is involved) if any of these happen:
a high or imminent safety message is missed or not reviewed in time, personal data shows up
somewhere it shouldn't (logs, AI prompts, emails to the wrong person), or a deletion leaves data
behind.
