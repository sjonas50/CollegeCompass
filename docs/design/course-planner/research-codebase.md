# School-aware course planner: how it fits into the College Compass codebase

**How to read this.** All file paths are relative to `/Users/stevejonas/CollegeCompass` (branch `v2`, HEAD `115798d`). I didn't edit anything. The web search budget for this session had already run out, so all outside research here comes from fetching pages directly. A few official state pages returned 404 or didn't render, and those are marked **UNVERIFIED** below. I don't state any state rule I couldn't confirm from a primary source.

---

## 0. Summary

1. **The app has no idea of a state, school or school course list.** The only place state appears is `colleges.state` (College Scorecard data) and the college search filter. The AI counselor's system prompt explicitly says *"You do NOT know the student's name, school, or location"* (`src/lib/counselor/prompt.ts:30`). The privacy page's "What we collect" list doesn't mention state or school either.
2. **The Plan page is a manual course tracker.** Students type courses into `student_courses`, and the page shows a GPA estimate, a generic checklist, and course ideas matched by regular expressions. There's no standard set of course types to plan against. Course matching uses patterns on the typed names, such as `ALGEBRA_2_OR_BEYOND`. A planner needs a small, fixed list of course types (for example "Algebra II" or "chemistry") as its foundation.
3. **A lot can be reused.** GPA weighting, the checklist statuses, the major-family table (`CIP_FAMILY_IDEAS`), the career-to-major-to-college chain (`getCareer`, `majorsForCip6`, `offeredFamilies`), the college list (a student's target schools), `colleges.admissionRate` (for selectivity), the counselor tool pattern, the "AI explains, code decides" pattern in `matching/explain.ts`, and the reviewed-content pattern of the aid guide.
4. **State and school should live on the student, not the household.** Brothers and sisters in one household can be at different schools, and a 7th grader's high school is a future school. Home state is coarse enough to give the AI. The school must never be given to the AI, written to the audit log, or counted anywhere that could point to one student.
5. **Course-guide extraction needs new infrastructure:**
   - a place to put files (there's no blob storage and no upload route today);
   - a separate AI budget (today's budget is $3 per student per month, and one guide costs roughly $1–3 to extract);
   - protection against the server being tricked into fetching internal addresses when it fetches a family's link (nothing does this today);
   - a background job, because extraction can take minutes.

   **My recommendation: start with links only, don't keep the raw file, and have staff approve each extraction before it's shared with other families.**
6. **State rules should be reviewed content files in the repo, not database tables.** Model them on the aid guide: a checked schema, review status, content fingerprint, sources, and which graduating classes each rule applies to. Add a test that fails when the rules go out of date, as the roadmap milestones already do. School course lists, by contrast, are data families add at runtime, so they belong in the database. The school directory should be loaded by `scripts/load-reference.ts`, and nothing families add may have a foreign key to it (the same rule CLAUDE.md already applies to occupation codes).
7. **To keep the AI from inventing courses,** the AI's structured output should refer to course IDs from the list we give it. The server drops any ID it doesn't recognise and shows course names from our own data, the same way `explain.ts` already drops career codes it didn't ask about.

---

## 1. What exists today

### 1.1 Data model (`src/db/schema.ts`)

| Table | What matters for the planner |
|---|---|
| `users` | `grade` plus `gradeSchoolYear`, with `currentGrade()` moving the grade up each August (`src/lib/auth/age.ts`). This means **the graduating class can be worked out**, which rules need. `householdId`, `parentManaged` and `birthDate` are here too. **No state, school or zip.** |
| `households` | Only `id` and `createdAt`. Access (trial, subscription, grants) and billing hang off it. |
| `student_courses` | `name` (up to 80 characters of free text), `subject` (10 values), `level` (regular, honors, AP, IB, dual enrollment), `gradeLevel` (7–12), `term`, `credits` (0.25–2 in quarter steps), `status` (planned, in progress, completed), `finalGrade` (only for completed courses; P, W and I don't count toward GPA), `highSchoolCredit` (defaults to on for grade 9 and up), timestamps. Indexed on (userId, gradeLevel). Linked to the user with delete-cascade. **There's no course type, no link to a school catalog, and no record of where a course came from.** A student can have at most 120 courses (`MAX_COURSES` in `src/lib/courses/service.ts`). |
| `north_star_goals` | Up to 2 target careers per student (O*NET code and title, no foreign key). This is the only "goal" the app stores. **There's no target major.** |
| `college_list` | The student's target colleges (`unitId` with no foreign key, or a custom entry). This is the natural input for "the university that fits". |
| Reference tables | `occupations`, `majors` (CIP 2020), `cip_soc_links` (majors to careers), `colleges` (with `state`, `control` meaning public/private, and `admissionRate`), `college_programs` (4-digit CIP code per college). All of them are replaced wholesale by `npm run data:load`. |
| `ai_usage` | Linked to a student (set to null when the student is deleted). Has feature, model, tokens and cost. The monthly budget is enforced per student. |

### 1.2 How the Plan page works (`src/app/plan/*`)

- `page.tsx` is a server component. It calls `requireUser(["student"])` and then `requireFullAccess`; without full access the student is redirected to `/account/access`. "Your class plan" is in `FULL_ACCESS_FEATURES` (`src/lib/access/describe.ts`), so the page is behind the paywall.
- It loads `listCourses`, then works out `courseSuggestions` (from the student's north-star careers), `computeGpa` and `collegePrepChecklist`. The page adjusts to the student's stage: grades 7–8 (explore), 9–10 (build), 11–12 (launch), or graduated.
- The layout is:
  - an intro card when the student has no courses yet;
  - the GPA card (moved lower for middle schoolers);
  - one collapsible section per grade, 7 through 12 (`grade-section.tsx`). The current grade comes first and open, then later years, then earlier ones (`gradeOrder` in `src/lib/courses/plan-layout.ts`);
  - the college-prep checklist card and the course-ideas card (`cards.tsx`).
- Each grade has an add form (`add-course.tsx`) and edit/delete rows (`course-row.tsx`, `course-fields.tsx`). They use `useFormAction` so typed values survive validation errors. They call `addCourseAction`, `updateCourseAction` and `deleteCourseAction` in `src/app/actions/plan.ts`: sign-in and access checks, then `CourseInputSchema`, then `src/lib/courses/service.ts`, then `revalidatePath("/plan")`.

### 1.3 Library code (`src/lib/courses/*`)

- `catalog.ts`: labels for subjects, levels and terms, letter grades, credit options, and the defaults for high school credit and status.
- `gpa.ts`: GPA on a 4.0 scale; weighted GPA adds 0.5 for honors and 1.0 for AP, IB and dual enrollment; the "this is an estimate" caveat.
- `checklist.ts`: `COLLEGE_PREP_AREAS` (English 4, math 3 with 4 recommended, science 3, social studies 3, world language 2 with 3 recommended, arts 1). Each area is marked covered, on track or "room to add". There's an Algebra II check done by pattern-matching the course name, and a CTE credit count.
- `suggestions.ts`: about 40 generic course ideas, each with a pattern that decides whether a course already covers it; `CIP_FAMILY_IDEAS`, which maps 34 two-digit major families (CIP) to course ideas; a fallback based on interest areas (RIASEC); at most 6 ideas per career.
- `service.ts`: create, read, update and delete, plus `planSummary()`, the JSON the counselor's `get_my_plan` tool returns. It contains no IDs, and course names are passed through `scrubPii`.

### 1.4 Other code the planner will touch

- **Majors.** `getCareer()` (`src/lib/careers.ts`) returns a career's related majors (6-digit CIP) and whether colleges offer them. `majorsForCip6` and `offeredFamilies` are in `src/lib/colleges/search.ts`.
- **Colleges.** College search already has a `state` filter. The college page sets `inState = college.control === 1` (`src/app/colleges/[unitId]/page.tsx:74`) and shows `PUBLIC_IN_STATE_NOTE`, which really means "this is a public college". `outOfStateCost()` exists.
- **Roadmap.** `src/lib/roadmap/milestones.ts` is sourced, fact-checked content with `VERIFIED_FOR_SCHOOL_YEAR = 2026`, and a test fails once that year ends. Milestone IDs are permanent. Several milestones are course-planning steps: `g8-pick-your-9th-grade-classes`, `g9-sketch-four-year-plan`, `g9-see-college-course-requirements`, `g9-pick-10th-grade-classes`, `g10-pick-11th-grade-classes`, `g11-choose-senior-classes`. Their text currently says "rules differ by state".
- **Counselor.**
  - Its tools never take a user ID from the model (`src/lib/counselor/tools.ts`), and student-specific tools are in `extra-tools.ts`.
  - The per-student context is saved on each conversation and must be cleared with `forgetSavedContexts` whenever what it summarizes changes.
  - The aid guide tool passes along the guide's review status and a draft warning (`src/lib/aid-guide/counselor.ts`).
- **Aid guide.** Content lives in `src/content/aid-guide/{en,es}.json` and is checked by a Zod schema when loaded (a bad file fails `next build`). It carries a review status (`draft` or `counselor-reviewed`), a reviewer and date, and a SHA-256 fingerprint of the content (`fingerprint.ts`). It's currently `draft`, last updated 2026-09-24. The state aid section mixes items for several states in one list (Tennessee Promise, Texas FAFSA priority date, and others) with **no tag saying which state an item is for.**
- **Key dates.** `src/lib/applications/key-dates.ts` holds constants in code, each with the official source quoted in a comment and a checked date.
- **AI plumbing.**
  - `AiFeature = "safety" | "safety_backup" | "counselor" | "explain"`.
  - `assertWithinBudget` enforces $3 per student per month (`AI_MONTHLY_BUDGET_USD`).
  - The pattern is: `recordMessageUsage`, then `readStructuredOutput`, always using `messages.create` rather than `parse`, with server-side fallbacks set to "default" (`src/lib/matching/explain.ts:606-633`).
  - `StudentAiContext` is only `{grade, gradeBand}` (`src/lib/ai/privacy.ts`).
- **Privacy.** `exportStudentData` lists the columns it exports one by one. Planning data comes from `exportPlanningData`, plus `collegeList` and `exportHouseholdAccess`. `deleteStudent` deletes the user row, and everything else cascades. AI usage rows are kept but unlinked. Tests cover this: `test/planning-privacy.test.ts`, `test/privacy-promises.test.ts`, `test/export-audiences.test.ts`.
- **Platform.**
  - `src/proxy.ts` skips `/api` routes, so a route handler under `/api` avoids the proxy holding the whole request body in memory (a 10MB limit, per `proxyClientMaxBodySize` in the local Next docs).
  - Server actions accept 1MB bodies by default (`serverActions.bodySizeLimit`).
  - There's no blob or file storage dependency, and no upload route anywhere.
  - `outboundFetch` only works around a network-protocol problem; it doesn't block requests to internal addresses.

---

## 2. What can be reused

| Existing piece | Reuse | Caveat |
|---|---|---|
| `student_courses` and its forms and actions | This stays the student's course record. Planner suggestions become `planned` rows. | Add a nullable link to the school catalog course, a course type, and where the course came from (typed, school list, or planner). |
| `gpa.ts` weighting | Matches how at least one target university calculates GPA: UT Knoxville adds 0.5 for honors and 1.0 for AP, IB, Cambridge and dual enrollment on a 4-point scale (verified). | Which courses count toward a college's GPA differs by college, so the rules need a field for how GPA is counted. |
| `checklist.ts` statuses and "never framed as falling short" wording | Use for each set of requirements (state graduation, public university system, major prep). | Checks by subject must become checks by course type. |
| `ALGEBRA_2_OR_BEYOND` and the idea patterns in `suggestions.ts` | Starting point for a fixed list of course types, and the fallback for typed course names. | Pattern matching on free text must never be what decides a rule is met when a school list is available. |
| `CIP_FAMILY_IDEAS` (34 families) | The natural key for about 30 "major prep" families. | It's unreviewed editorial data today; major prep needs sources and review. |
| `getCareer().majors`, `majorsForCip6`, `offeredFamilies` | Derive "the major they're matched with" from their north-star careers. | There's no stored target major (see §6). |
| `college_list` (target colleges) plus `colleges.state`, `control`, `admissionRate` | Pick which rules apply (public college in their state, then the matching rule set) and how rigorous to aim (by admission rate). | Scorecard doesn't say which university *system* a college belongs to; the rules content has to list college IDs per system. |
| College search `state` filter, `PUBLIC_IN_STATE_NOTE`, `outOfStateCost` | "State unlocks in-state colleges": fill in the student's state by default, and label prices as in-state or out-of-state *for this student*. | `/colleges` is public and free, so the state picker can't live only on the gated `/plan`. |
| Counselor tools and extra tools | Add a `get_my_course_path` tool or extend `get_my_plan`, and add a public, student-independent rules tool. | Update the "do not know school or location" line and its tests. |
| `explain.ts` pattern (facts in, structured output, template fallback, stored result, unknown codes dropped) | Explaining the plan: the AI explains, code decides. | Charge it to the student's budget under a new feature name, with a template fallback. |
| Aid guide schema, checks and fingerprint | Template for rule content: review status, fingerprint, sources, a check at load time that fails the build. | Needs fields for which graduating classes a rule applies to and how strong it is (see §5). |
| Stale-content test on `VERIFIED_FOR_SCHOOL_YEAR` (milestones) | Same kind of stale-rules test per state. | |
| `load-reference.ts` plus `src/lib/reference/parsers.ts`, and the `check:*` scripts | Load a school directory and, optionally, a standard course-code list (SCED). Add `check:rules` and an extraction evaluation. | A wholesale replace means nothing families add may reference these tables with a foreign key. |
| `income-band.tsx` (kept only in the browser) | Precedent for storing a *visitor's* state in the browser on public pages. | |
| `consumeRateLimit`, `audit` | Rate-limit extractions; record catalog actions (with nothing personal in the log). | |

---

## 3. Where state and school should live, and what that means for privacy

### Recommendation: on the student
- Add `users.home_state` (a 2-letter code checked against `US_STATES`) and `users.high_school_id` (an NCES school ID stored as text, **no foreign key**). If the school needs history or a "current vs. planned" flag, use a separate `student_schools` table instead.
- Parents set these for a linked child the same way `setChildGradeAction` sets the grade. Students set them in their own settings (`src/components/student-settings.tsx`), not on `/plan`, so the free parts of the app (colleges, aid guide) can use them.
- Offer "use the same state for my other children" as a convenience rather than storing the state on the household.

Why the student and not the household:
- Brothers and sisters in one household can be at different schools, and middle schoolers pick their *future* high school.
- Teens who own their accounts control their own data.
- A linked parent may live in another state.
- Export and delete are already per student.

If state were stored on the household, CLAUDE.md would require it to be covered by `exportHouseholdAccess` and `deleteEmptyHousehold`. It would also mean changing `SessionUser`, which is where `grade` already comes from (`src/lib/auth/sessions.ts`).

### Privacy
- **The school narrows down who a student is.** First name, grade and school can identify a student at a small school. So:
  - **Never** put the school name or ID in `StudentAiContext`, the counselor context, `planSummary`, tool output, audit metadata, `daily_counts`, URLs or emails.
  - Don't write a "school_set" audit entry that includes the school ID.
  - Staff catalog tools should show usage only in coarse counts, never "1 student uses this list".
- **Course names from a school's list could hint at the school** (local names or codes). Either send the AI our standard course type plus a generic title, or accept this knowingly. That's the owner's call.
- **Sending the state to the AI is fine** (it's coarse, like grade). This is a deliberate change to `StudentAiContext` and `src/lib/ai/privacy.test.ts`. Call `forgetSavedContexts` whenever the state or targets change, if they're part of the saved context.
- **Export (`exportStudentData`):** add `home_state` and `high_school_id` to the profile columns, with the school's name resolved. Also add target majors, planner settings (for example a chosen Texas graduation plan or endorsement), course-to-catalog links, and any catalogs the student contributed (source link, status, date). A parent's copy should include all of this, since none of it is counselor-private. Update `test/export-audiences.test.ts` and `test/planning-privacy.test.ts`.
- **Delete:** fields on the student row, and tables with delete-cascade, go with the student. **Contributed catalogs** are shared data: keep them, but set the contributor link to null, as AI usage rows already are. If the contributor link sits on the household, add it to `deleteEmptyHousehold`.
- **Wording to update at the same time:** the counselor system prompt line 30; the privacy page's "What we collect" (`src/app/privacy/page.tsx:12`), plus a new line for uploads and links; `test/privacy-promises.test.ts`.
- **Visitors who aren't signed in** (public `/colleges` and `/aid`): keep their state in the browser only, like the income band. Never put it in a URL or send it to the server.
- **Gating:** choosing a state must be free, because colleges and the aid guide are never gated. The planner itself, school catalogs and extraction are full-access features. Add every new gated page, action and route to `src/lib/access/gating.test.ts`.

---

## 4. Extracting course lists from course guides with AI

### Limits and facts (verified)

| Where | Limit |
|---|---|
| Vercel Functions | Request or response body at most **4.5 MB** (error 413 `FUNCTION_PAYLOAD_TOO_LARGE`); runs 300s by default (up to 800s on Pro). |
| Next.js server actions | **1MB** body by default (`serverActions.bodySizeLimit`), and multipart overhead counts. Don't upload through a server action. |
| Next.js proxy | Holds up to 10MB of the body in memory. Doesn't apply here, because `/api` is excluded from the proxy. |
| Anthropic PDF input | **32 MB** request; **600 pages** (100 if the context window is under 1M tokens); no password-protected PDFs. Sources: `url`, `base64` or `file_id`. Each page is processed as text *and* an image, at about **1,500–3,000 text tokens per page plus image tokens**. Citations **can't be combined with** structured output (`output_config.format`) — the API returns a 400. The Batch API costs 50% less, but doesn't accept the `fallbacks` parameter. |

**Cost estimate** (my arithmetic from the above): a guide of about 80 pages is roughly 200–320k input tokens plus around 30k output tokens. That's about **$1.50–2.50 on Opus 5**, about $0.60–1.00 on Sonnet 5, and about half that through the Batch API. It must not come out of a student's $3 monthly budget.

### Recommended flow
1. **Intake, links first.**
   - A family pastes a link and the school year.
   - For PDFs, pass the link to Anthropic as a `url` source, so Anthropic fetches it and our server never fetches arbitrary addresses.
   - For HTML guides, either fetch server-side with guards (https only, block private and internal addresses, limit redirects, size and content type), or use the `web_fetch` server tool.
   - Accept file uploads later, through `POST /api/catalogs`, up to 4 MB, not through a server action. Larger files would need Vercel Blob client uploads, which means a new vendor to cover in the privacy docs and CSP.
2. **Don't keep the raw document.** Store the source link, a SHA-256 of the file (to catch duplicates and show where data came from), the page count, the model and extraction-schema version, and the extracted rows. Re-fetch the source if extraction has to be rerun. Storing facts rather than the document also avoids redistributing a private school's copyrighted guide.
3. **Run it in the background.** Create a catalog record with status `extracting`. Then either:
   - run it through `after()` (already used in `src/app/api/counselor/route.ts`) with `maxDuration`; or
   - have a cron job submit it to the **Batch API** and collect results later (`vercel.json` already has crons).

   Split big guides into page ranges (for example 30–40 pages each) so each request's output stays bounded, and stream long outputs (`finalMessage()`).
4. **The AI call itself.**
   - Use `messages.create` with `betaZodOutputFormat` and a schema restricted to our own vocabulary. Suggested fields: `documentKind` (course catalog, student-specific record, or other), `schoolYear`, and for each course: name, local code, subject (our 10 values), level (our 5 plus "other"), credits, term, eligible grades, prerequisite text and codes, AP/IB/dual-credit flags, CTE pathway, suggested course type (from our list or "none"), and source page.
   - Record usage **before** reading the output, and handle refusals and responses cut off at the token limit.
   - **The only input is the document and the public facts about the school. No student data, no uploader identity.**
5. **Budget.**
   - Add `AiFeature` values: `"catalog_extract"` (not charged to a student) and `"plan_explain"` (charged to the student).
   - `recordUsage` currently requires a user ID. Allow null for catalog extraction, plus a monthly total cap across all catalogs (for example `AI_CATALOG_MONTHLY_BUDGET_USD`), plus a per-household rate limit through `consumeRateLimit`.
   - **Fix `costReport`:** it currently treats every row without a user as spend by deleted accounts (`src/lib/admin/costs.ts:91`). It should split out catalog extraction by feature.
6. **Safety and quality.**
   - *Prompt injection in the document:* the call has no tools, no student data and a constrained output, and a person reviews the result.
   - *Personal data in an upload* (a transcript or schedule with a name) would break the "no names to the AI" rule before we could catch it. That's the main argument for starting with links only. If uploads are added, show a clear notice, have the schema flag `documentKind: "student-specific record"`, and then discard it without storing anything.
   - Keep the source page number on every course so people can spot-check it.
   - Add an extraction evaluation (`scripts/eval-extraction.ts`, alongside `eval-safety` and `eval-counselor`) using a few hand-labelled guides from Utah, Tennessee and Texas.
7. **Who confirms.** A shared list trains the *next* family, so a family's own approval shouldn't publish it to everyone. I suggest:
   - `needs_review`: the AI's output, visible only to the family who contributed it, clearly marked as a draft;
   - `family_confirmed`: usable by that household;
   - `published`: approved by staff under `/admin` (admin role, audited), shared with every family at that school, one version per school year, with last year's list shown as "last year's list" until replaced.

---

## 5. How to store and version reviewed state rules

The repo uses three patterns:

| Pattern | Used for | Fits rules? |
|---|---|---|
| Content JSON checked by Zod with review status and fingerprint (aid guide) | Reviewed prose with sources | **Yes: the main recommendation.** |
| Constants in code with source comments and a "verified for" year (key dates, milestones) | Small, date-sensitive facts | Yes, for tables used across states (for example rigor bands). |
| Database reference tables loaded by `load-reference.ts` | Large machine-readable public datasets | **No**, because rules are hand-curated from PDFs and web pages. **Yes** for a school directory and a course-code list. |

Recommendation:
- **Files:** `src/content/course-rules/{ut,tn,tx}.json`, `src/content/major-prep/*.json` (keyed by CIP family) and `src/content/rigor.json`, loaded through `src/lib/course-rules/{schema,validate,index}.ts` using the aid-guide approach. Validation happens at import, so tests and `next build` fail on bad content.
- **Each rule records:**
  - `scope`: state graduation, public-system admission, one college's admission, one program's admission, state aid eligibility, or guaranteed admission;
  - `strength`: required, strongly encouraged, or recommended;
  - which graduating classes it applies to (from and to);
  - the requirements, written in terms of our course types;
  - the colleges it covers (for system-wide rules);
  - `sources[]`: link, short quote, and date checked;
  - review status, reviewer, review date and content fingerprint;
  - `verifiedForSchoolYear`, with a test that fails once it's stale.

  The counselor tool passes along "draft" warnings the same way `aidGuideToolResult` does.
- **Versioning:** use git plus the fingerprint. Every plan result shows "based on Tennessee rules reviewed on ...", and a stored explanation records the fingerprint it was made against, as `explain.ts` does with `factsVersion`. Add a `scripts/check-rules.ts` (like `check:matching`) that confirms source links still load and every college ID in a system list exists in `colleges`.
- **School directory and course codes:**
  - School directory: NCES Common Core of Data for public schools, possibly the Private School Survey later. I confirmed the Common Core of Data publishes school directory data, but I **haven't verified the exact file, release or fields**.
  - Optional course codes: **SCED v13.0 (2025)** is a free download (`SCEDv13File_508.xlsx`) built on a five-digit course code (verified on nces.ed.gov).

  Load both through `load-reference.ts`, and keep **every school ID in family-added tables as a plain value with no foreign key**, the same rule CLAUDE.md already applies to occupation codes.

### What the rules actually look like in the three states (checked against official pages)
- **Tennessee (UT Knoxville):** UTK *"strongly encourages (but does not require)"* 16 core courses:
  - 4 English;
  - 4 math (algebra, geometry, trigonometry, calculus, statistics or other advanced math);
  - 3 science;
  - 1 American history, plus 1 European history, world history or world geography;
  - 2 years of one foreign language (or ASL);
  - 1 visual or performing arts.

  UTK calculates a weighted core GPA and *requires* ACT/SAT scores. Engineering programs state minimums: math ACT 25 or math SAT 590, and an "SPI of 60". So the model needs `strength`, rules at the program level, how the college counts GPA, and test requirements.
- **Utah:** "Admit Utah" launched on October 4, 2024. Every Utah high school student is notified of guaranteed admission to one or more of the 16 public colleges, *"regardless of their GPA"*. The site's quiz asks for GPA, so which colleges are guaranteed appears to depend on GPA. **Those GPA levels aren't verified.** The model needs a "guaranteed admission by GPA" rule type as well as course lists. The Utah Opportunity Scholarship is applied for in senior year; **its course and GPA requirements aren't verified.**
- **Texas:** the TEA says the four graduation plans in use require 22–26 credits, including the Foundation High School Program, under 19 TAC chapter 74, subchapter B. **Not verified in this pass** (TEA and statute pages returned 404 or didn't render): endorsements, the distinguished level of achievement, and how it connects to automatic admission. These probably mean storing a student's plan choice, which is new student data.
- **UNVERIFIED and still needed:** Tennessee HOPE scholarship eligibility, UT Austin automatic admission, Texas state aid course requirements, and each state's official course-code list (`tn.gov` returned 404).

---

## 6. Data model sketch
- `users`: add `home_state` and `high_school_id` (no foreign key).
- `schools` (reference data, replaced on each load): `nces_id` (primary key), name, state, city, lowest and highest grade, type, source release.
- `school_catalogs`:
  - `id`, `school_id` (text, no foreign key), `school_year`;
  - `status` (extracting, needs_review, family_confirmed, published, rejected);
  - source type, `source_url`, `source_sha256`, page count;
  - model, extraction-schema version;
  - `contributed_by_user_id` and `confirmed_by_user_id` (both set to null when that user is deleted);
  - timestamps.
- `school_catalog_courses`: catalog ID (deleted with the catalog), local code, name, subject, level, credits, term, eligible grades, prerequisite text and codes, flags, `course_type`, source page, confirmed.
- `student_courses`: add `catalog_course_id` (set to null if the catalog course is deleted), `course_type`, and `source`.
- `target_majors`: at most 2 per student, CIP code and title with no foreign key, filled in from north stars by default. This is where "the major they're matched with" is stored.
- `student_plan_prefs`: target rule set or system, Texas plan or endorsement choice, suggestions the student dismissed. Deleted with the student and included in the export.
- **Plans are worked out on the fly by pure functions, not stored.** Only the student's choices and accepted courses are saved.
- Run `npm run db:generate` and commit the migration.

## 7. Planner engine and where the AI stops
- Pure functions in `src/lib/courses/planner/*`.
- **Inputs:** graduating class (from `currentGrade`), courses done, in progress and planned, the school's list (or generic course types), the rule sets (state graduation plus target system or college), major prep, and the rigor band (from `colleges.admissionRate`).
- **Outputs:** coverage for each rule with its status and sources; sequences that respect prerequisites (for example the math ladder); a per-year load limit (from the school list, or a sensible default); and "draft — take it to your school counselor" wording.
- **The AI only explains** (`plan_explain`, template fallback, budget-checked). Its structured output refers to **course and rule IDs** that the server checks. Questions go to the existing counselor, via a deep link with a pre-filled question, so every question still goes through `assessMessage`. The planner must not add a new chat box that skips safety screening.

## 8. Concrete integration points
- `src/db/schema.ts` plus a migration.
- `src/lib/courses/{catalog,checklist,suggestions,service}.ts`: course types, rule-based checklists, and `planSummary` with the path (no school).
- `src/app/plan/*`: a new "Your path" section, choosing from the school's list in `course-fields.tsx`, and planner actions in `src/app/actions/plan.ts` (behind `requireFullAccess`).
- `src/app/actions/settings.ts` and `src/components/student-settings.tsx`, plus parent settings on `/parent`: state and school pickers.
- `/colleges` search default and college page: in-state or out-of-state wording based on the student's state (`[unitId]/page.tsx:74`).
- Aid guide: tag state-specific items with their state (schema change, keeping English and Spanish in step) so "state unlocks state aid" can filter them.
- `src/lib/counselor/{prompt,extra-tools,college-tools}.ts`: update line 30, add the path tool and a rules tool that passes along review status.
- `src/lib/ai/{privacy,models,usage}.ts` and `src/lib/admin/costs.ts`: add state to the AI context, add the new features, allow a null user for extraction, and add the catalog budget.
- `src/lib/privacy.ts`, `src/app/privacy/page.tsx`, and the privacy and export tests.
- `src/lib/access/gating.test.ts` and `describe.ts` (free vs. full access).
- Roadmap course milestones: link to the path. **Never change milestone IDs.**
- `scripts/load-reference.ts` (school directory, SCED), plus new `scripts/check-rules.ts` and `scripts/eval-extraction.ts`.
- New `src/app/api/catalogs/route.ts` (outside the proxy) and `/admin/catalogs` for review.

## 9. Risks (most serious first)
1. **A wrong or out-of-date rule leads a minor to the wrong courses.** Mitigate with review status, sources, which graduating classes a rule applies to, stale-content tests, "draft for your counselor" wording, and never promising admission.
2. **A bad or deliberately corrupted AI extraction spreads to other families** through shared lists. Mitigate with staff approval before publishing and a stored page number for every course.
3. **Personal data inside an upload reaches the AI**, breaking the "no names to the AI" rule in CLAUDE.md. Start with links only.
4. **The school identifies the student** if it leaks into AI context, audit entries, admin views or analytics.
5. **Extraction costs aren't capped or are charged to the wrong place:** they'd count against students' budgets and be mislabelled as deleted-account spend in `costReport`.
6. **Platform limits:** 4.5 MB request bodies, 1MB server actions, 300s function time, and the server fetching unsafe addresses from family-supplied links.
7. **`npm run data:load` could wipe catalogs or student links** if they use foreign keys to reference tables.
8. **Content upkeep grows fast:** 3 states × (graduation rules, public system rules, aid) plus about 30 major families plus rigor, and each needs review every year. Plan for the reviewer time.
9. **Edge cases:** middle schoolers whose high school isn't settled, students who change school partway through, Texas plan or endorsement choices, and private or charter schools missing from the directory.
10. **Promises must change together:** the counselor prompt, the privacy page and the tests all currently say "we don't know the school".

## 10. Open questions for the owner
- For shared lists: is a family's confirmation enough, or does staff approve before publishing?
- Should the AI see course names from the school's list, or only our standard course types?
- Links only at launch?
- One extraction model per catalog (Opus 5 or Sonnet 5), and Batch API or immediate?
- Store state on the household instead? (I recommend on the student.)

---

## Sources
- Vercel Functions limits (4.5 MB request body, run time): https://vercel.com/docs/functions/limitations
- Anthropic PDF support (32 MB, 600 pages, tokens per page, URL, base64 and Files API sources, citations vs. structured output): https://platform.claude.com/docs/en/build-with-claude/pdf-support
- NCES SCED v13.0 (five-digit course code, downloadable file): https://nces.ed.gov/forum/sced.asp
- NCES Common Core of Data files (school directory data; exact file not verified): https://nces.ed.gov/ccd/files.asp
- UT Knoxville first-year admission (16 core courses "strongly encouraged", weighted core GPA, ACT/SAT required, engineering minimums): https://admissions.utk.edu/apply/first-year/
- USHE Admit Utah announcement (October 4, 2024; guaranteed admission "regardless of their GPA"): https://ushe.edu/utah-launches-admit-utah-a-simplified-path-to-college-admissions-for-all-high-school-students/
- Admit Utah (the site's quiz asks for GPA): https://admitutah.org/
- USHE state scholarships (Opportunity Scholarship applied for in senior year): https://ushe.edu/state-scholarships-aid/
- TEA graduation information (four plans, 22–26 credits) and the Foundation High School Program page (points to 19 TAC ch. 74 subch. B): https://tea.texas.gov/academics/graduation-information and https://tea.texas.gov/educators/graduation-information/foundation-high-school-program
- Next.js docs in the repo: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` and `proxyClientMaxBodySize.md`

---

**Notes added during the final synthesis (2026-09-25):** HEAD is now `2b450f0`. The items this report marked UNVERIFIED (the DLA and automatic admission, Tennessee HOPE, the Utah Opportunity Scholarship, the state course-code lists) were verified by the state and guides research; see research-texas.md, research-tennessee.md, research-utah.md and research-guides.md. `StudentSettings` renders on `/dashboard` (`src/app/dashboard/page.tsx`). The Anthropic prices in `src/lib/ai/models.ts` are Opus 5.5 $4/$20, Opus 5 $5/$25, Sonnet 5 $2/$10 and Haiku 4.5 $1/$5 per million tokens.
