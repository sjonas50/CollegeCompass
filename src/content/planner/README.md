# Course planner rule content

Reviewed content the course planner reads: state graduation rules, graduation options, college
admission patterns, program gates, the course parts of state aid, college-credit facts, generic
class lists, the 32 major families, CIP routing and rigor guidance. The format is defined in
`src/lib/planner/rules.ts` and `content-types.ts` (zod schemas in `content-schema.ts`); the files
are validated when `src/lib/planner/content.ts` is first imported, so bad content fails the tests
and the build. Design: `docs/design/course-planner/design.md` §3.1, §3.2, §3.7, §4.4-4.5 and
Appendix A; sources: the research reports next to it.

| File | Holds |
|---|---|
| `{ut,tn,tx}/graduation.json` | The state graduation rule set, one variant per cohort, with non-course conditions ("We don't track this"), checks, warnings and "Ask your counselor" items |
| `tn/options.json`, `tx/options.json` | Choices a student makes: Tennessee's elective focus; Texas endorsements and the Distinguished Level of Achievement (DLA) |
| `{ut,tn,tx}/admissions.json` | Public universities' course patterns (required, strongly encouraged or recommended, in each college's words), program gates, and information cards (open admission, GPA cutoffs, test policies) |
| `{ut,tn,tx}/aid.json` | Course parts of state aid (Utah Opportunity, TEXAS Grant priority) and information cards (Tennessee HOPE, GAMS, TEOG) |
| `{ut,tn,tx}/facts.json` | Gap options the state verifies (college credit, online, summer, credit by exam, doubling up), middle-school math notes, and the state's words for college credit ("concurrent enrollment" in Utah, "dual credit" in Texas) |
| `{ut,tn,tx}/generic-catalog.json` | "Classes most <State> high schools offer", used until a school's own list exists |
| `major-prep/families.json` | The 32 major families: math target, sciences, key courses, rigor-first subjects, CTE pathways (Texas and Utah), the Texas endorsement a goal names (STEM programs; nursing's Public Services), published gates and cautions |
| `major-prep/cip-routing.json` | CIP code to family, first match wins |
| `major-prep/rigor.json` | Rigor tiers by selectivity, tier raises for program gates, and the load guardrails |

Adding a file means adding it to `src/lib/planner/content-files.ts` and `content.ts` (a test checks
the folder, the manifest and the loader agree).

## Rules for authors

- **Quote every claim.** Every requirement, check, condition, warning, test route, card, fact,
  family line and rigor line cites at least one entry in its file's `citations`: the source's own
  words, 300 characters or fewer, from a primary source (statute, rule, agency policy, institution
  page or catalog). Use "…" for words left out. Each source has an https link and a `checkedOn`
  date. Citation ids are shared across files only when the quote and source are identical.
- **Strength words come from the source.** `strength` (required, strongly encouraged, recommended,
  priority, info) must be backed by the words of `strengthCite`; `check:rules` and a content test
  check this. UT Knoxville's 16 units are "strongly encouraged" because its page says so.
- **Unverified or conflicting means "Ask your counselor".** Anything the research couldn't confirm
  goes in a variant's `unverified` list, a card with `confidence: "unverified"` or
  `"conflicting"`, or a rule set with that confidence, never in a label or summary as fact. Never
  state minimum ages or hours for nurse aides, EMTs or cosmetology, make "premed requirement"
  claims, or mention Utah's closed New Century scholarship.
- **Texas wording.** The DLA is "the course route" to automatic admission, and the test-score route
  stays open (its scores are being rewritten, so don't hard-code them). Skipping Algebra II lowers
  TEXAS Grant priority; never write "no TEXAS Grant" or "no TEOG". The Algebra II warning is exactly
  `TX_ALGEBRA_2_NOTE` in `src/lib/planner/copy.ts`.
- **Cohorts.** Utah keys graduation on the class (graduation year); Texas and Tennessee on the year
  the student started 9th grade. Every class from 2027 to 2034 must resolve to one variant or be
  projected. `projectedBeyond` is the last cohort the state has published rules for *and* that is
  in high school in the checked school year (the class of 2030); younger students see today's
  rules labeled "Projected", which can never show Done. A change for future cohorts adds a variant;
  a change for current cohorts edits the variant (and resets review). Ids are permanent.
- **Options extend graduation.** A Texas endorsement, the DLA or a Tennessee elective focus has one
  variant per graduation variant, with `extends` pointing at the graduation variant of the same
  cohort (a test checks it). Endorsement course sets are `shareable` (19 TAC §74.13(g)).
- **Programs of study are one cluster.** A Texas endorsement's CTE route is "a CTE completer in one
  of the following programs of study", so it's an `any` of one 3-credit leaf per career cluster,
  never a flat list across clusters. A program that counts only under a condition gets a
  `counts_unless` check (engineering and IT under Business and Industry, §74.13(f)(7)(B)).
- **What only counts once done.** A leaf that finishes a requirement only when already passed
  (Utah: calculus with a C finishes math) is `onlyWhenDone`: the planner never plans toward it or
  shows it as the requirement until it's finished.
- **Test routes name what they replace.** A test route without `reqIds` stands in for the rule
  set's whole class route (UT Austin calculus readiness); with `reqIds` only for those requirements
  or checks (Utah's math competency replaces the senior-year math class, not the CTE credit). A
  dated route (`by`) is the default in the plan when the class route isn't planned.
- **"On schedule" isn't "done by".** The DLA's Algebra II can be planned for 12th: by the end of
  11th the plan must show it (TEC §51.803(d)), so it has no `deadlineGrade`; the `on_schedule_by`
  check lists what must be on the plan (`req` and `with`).
- **Colleges** are named by Scorecard UNITID; `check:rules` confirms they exist after
  `npm run data:load`.

## Choices made where the sources leave a gap (all flagged in the content)

- Tennessee lists four required social studies classes for 3 credits without the split (only U.S.
  Government is known to be a half credit). Each class needs at least half a credit and the rest
  of the 3 credits can be any social studies; an "Ask your counselor" item explains.
- Texas endorsement routes through a CTE program of study plan for three courses in one of the
  listed clusters; how many make a "completer" isn't in the rule, so each says "Ask your counselor".
  Nursing and biomedical science count for Public Services only when STEM's math and science
  aren't met; our clusters can't tell those programs from the other health science programs, so
  the health leaf says so and asks the counselor.
- Microbiology is "if offered" in the research, so nursing's sciences leave it out; any major-prep
  class no remaining grade's list offers is never a gap.
- Utah's R277-700-6(9) (a math class passed before 9th grade still leaves 3.0 more math credits)
  is a shareable "3 math credits in grades 9-12" leaf inside the Secondary Math route; the rule's
  list of which classes isn't quoted, so any high school math class counts toward it.
- College admission "math units" count Algebra I and up (the math ladder, classes after Algebra II,
  and statistics): not "Other math class" or foundations math (UT Austin: "All courses should be at
  the level of Algebra I or higher").
- Tennessee's elective focus is 3 credits beyond the core, checked when the student picks a focus
  (the graduation total of 22 credits covers it before then).
- Tennessee's list of CTE programs of study wasn't verified, so no family names Tennessee pathways.
- Pre-nursing (CIP 51.1105) routes to nursing, ahead of the pre-health rule for 51.11.
- A career whose majors route to several families goes to the family whose majors the most
  colleges offer (each major weighed by the colleges offering its 4-digit family), not to the
  family with the most majors: Software Developers has 8 narrow IT majors but routes to computer
  science (design §5.13), because 11.01, 11.07 and 11.04 are far more widely offered.
- Texas's 4th English credit lists Public Speaking III, Debate III and the level III journalism
  classes, and Communication Applications only as a half credit paired with a different listed
  class (19 TAC §74.12(b)(1)(G)-(O)). The course types can't tell level III from level I, so
  speech, debate and journalism don't count toward it; the note sends the student to the counselor.
- Texas's generic list offers Transportation levels 1-3 (a Business and Industry program of study),
  like the other career clusters most high schools offer (19 TAC §74.3(b)(2)(G)).
- Utah's "Modern Mathematics" (a Secondary Math III opt-out choice) has no course type; it's named
  in a note rather than mapped to "Other math class".

## Review and staleness

Every file starts as `review: { "status": "draft" }`, shown to everyone as "Not yet reviewed by a
school counselor" (no review gate in the proof of concept). After a counselor reviews the exact
rendered content, set `counselor-reviewed` with `reviewedBy`, `reviewedOn` and the
`contentFingerprint` that `npm run check:rules` prints; any later edit fails validation until the
review is redone or the status goes back to draft.

Files are checked for a school year (`verifiedForSchoolYear`); after July 31 of the next year, or a
rule set's own `recheckBy`, every line reads "Checked for 2026-27; being re-checked. Ask your
counselor." and nothing can show Done. Dates never fail CI; `check:rules` warns 60 days ahead.
Re-check before registration season each December and FAFSA season each October, and on known
triggers: Texas's new automatic-admission test scores (tx.dla re-check 2027-06-30), UT Austin's
yearly automatic-admission percentage (by Sept 15), Utah's American Constitutional Government
standards and the 2027-28 course-list changes, the Opportunity Scholarship's class of 2028 rules,
and Tennessee State Board revisions.

## Checking

```
npm run check:rules                   # schema, citations, strength words, saved copies, staleness, diff vs HEAD
npm run check:rules -- --base v2      # what changed since another revision
npm run check:rules -- --live         # also look for each quote on the live page (drift is a warning)
```

Quotes are checked against saved copies of the sources in
`.data/course-rules-verified/{ut,tn,tx,major-prep}/<SOURCE-KEY>.txt` (kept outside git, like
`.data/aid-guide-verified/`): plain text of each page or PDF as it was read. A quote missing from
its saved copy fails the check; sources without a saved copy are listed. With a database loaded
(`npm run data:load`), UNITIDs and CIP prefixes are checked too.
