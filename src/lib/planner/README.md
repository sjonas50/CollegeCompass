# Course planner: shared contracts

Types, vocabulary and schemas that the planner's builders code against: the content authors, the
engine, and the UI and data layer. Nothing here plans, touches the database, or renders UI. The
design is in `docs/design/course-planner/design.md` (§5 is the engine). The owner's
proof-of-concept decisions override the design where they differ; see the end of this file.

| File | What it defines |
|---|---|
| `common.ts` | `PlannerState` (UT, TN, TX), `SchoolGrade`, quarter-credit units (`toUnits`, `toCredits`), ISO dates, school-year labels |
| `course-types.ts` | The course-type vocabulary: ids, levels, CTE, ladders, prerequisites, capabilities, state titles |
| `course-type-guess.ts` | From a `student_courses` row (subject, level, typed name) to a type (`resolveRowCourseType`); guesses are *assumed*, with how sure they are and every kind the row might be (`guessCourseType`) |
| `exact-titles.ts` | Exact titles: a typed name that's the official or canonical title of exactly one kind in the student's state is that kind, confirmed (`exactCourseType`, `exactTitlesFor`) |
| `beta.ts` | "Your path" is in beta: `plannerPathEnabled` (households marked by staff, or `PLANNER_PATH=everyone`) and `npm run beta:planner` |
| `families.ts` | The 32 major-family ids, math targets (CALC … APPLIED), the CIP routing type and `routeCip` |
| `rules.ts` | The rule language: rule files, rule sets, variants, requirements, selectors, checks, conditions, gates, review |
| `content-types.ts` | The other content files: generic catalog, state facts (gap options), families, CIP routing |
| `content-schema.ts` | Zod schemas for every content file; their types equal the hand-written ones (pinned by a test) |
| `validate.ts` | Validator stub: cross-file checks, `loadContent`, `contentForState`, `countAlternatives` |
| `review.ts` | Content fingerprint, review labels, staleness (`isStale`, `staleLabel`) |
| `engine-io.ts` | `PlannerInput` and `PathResult` for `plan(input)`, plus the owner's limits |
| `cohort.ts` | `deriveCohort` (grade-9 entry year, class year, grade-7 entry year), `cohortValue` |
| `copy.ts` | Fixed wording: draft notice, the IEP/504/English-learner note, Texas Algebra II wording, status labels |
| `fixtures.ts` | Tiny made-up content and a `PlannerInput` for tests (not real quotes; never copy into content) |
| `content.ts` | Loads and validates the real content in `src/content/planner/` at import; `plannerContentFor(state)`, review notices, staleness, college lookups, CIP routing |
| `content-files.ts` | The list of content files (the loader and `check:rules` share it) |
| `content-check.ts` | The checks behind `npm run check:rules`: citation coverage, strength words, saved-copy quotes, staleness warnings, the diff summary |
| `quotes.ts` | Comparing a quote with its source text (spacing, punctuation and case ignored; "…" for left-out words) |
| `routing.ts` | North-star careers to family targets through the CIP rules (pure) |
| `north-stars.ts` | `northStarFamilyTargets(db, userId)`: the student's north stars, routed |
| `engine/` | The engine: `plan(input)` (see `engine/README.md`) |
| `prefs.ts` | `student_plan_prefs`: the kind of path, a chosen family, choices, limits, cohort overrides and set-aside suggestions, checked field by field when read |
| `service.ts` | `studentPath(db, userId)`: gathers the engine's input from the database (grade, cohort, state, classes, north stars routed to families, the college list, prefs; generic class lists for now) and runs the engine. Add (`acceptSuggestion`), "Not for me" (`dismissSuggestion`), settings, and the parent summary (`pathOverview`) |
| `view.ts` | Wording shared by "Your path", the print view, the parent view and `/graduation/[state]` |

### Where it shows

"Your path" and everything below that shows it (the print views, the parent's read-only path and
dashboard block, the roadmap's "Open your path" links, the path's actions) is in beta: only for
households staff mark with `npm run beta:planner`, or for everyone with
`PLANNER_PATH=everyone` (`beta.ts`). Everyone else keeps today's checklist and course ideas. Staff
accounts have no page that shows a path (`/plan` is for students, the parent pages for parents, and
`/admin` has no path view), so staff preview it with a test household in the beta.

- `/plan` "Your path" (`src/app/plan/path/`): full access. Suggestions are looked up by key in
  today's plan before anything is added, so the browser never decides what's added.
- `/plan/print` and `/parent/children/[id]/plan` (+ `/print`): the counselor-meeting draft and the
  parent's read-only view, full access.
- `/graduation` and `/graduation/[state]`: free, from the same content.
- Roadmap milestones about choosing classes link to `/plan#path` (`COURSE_PLANNING_MILESTONES`).
- Students outside UT, TN and TX keep the checklist and course ideas, plus "coming later".
- The school is shown only on the student's and parent's own screens; the engine never gets it,
  so nothing from the path can carry it to the AI (`test/school-ai-privacy.test.ts`).

## Conventions

- **Units.** Credits are quarter-credit units everywhere: 4 = 1 credit, 2 = a semester.
- **Ids are permanent.** Course types, families, rule sets, variants and citations are referenced by
  stored data and content. Rename titles freely; never rename or reuse an id.
- **Code decides.** The AI never decides what counts. Nothing here is sent to the AI except generic
  type titles and levels.

## Course types (`course-types.ts`)

243 ids: 135 written out, plus `lang.<code>.<1-4>` for 13 languages and `cte.<cluster>.<1-4>` for 14
career clusters. Each type has a generic title, one of the app's 10 subjects (plus `altSubjects`
students often use), default units, a usual grade window, prerequisites (each met by any one listed
type), and optionally a ladder rank, capabilities and state display names.

- **Prerequisites by level**: `collegePrereqs` adds prerequisites for the AP, IB, Cambridge and
  college-credit versions only (AP Statistics after Algebra II; regular Statistics after Algebra I).
- **Levels** (the task's "level capabilities"): `levels` lists the rigor levels a class is offered at
  (regular, honors, AP, IB, Cambridge, and `dual_enrollment` for college credit, labeled "CE" in Utah
  and "Dual credit" in Texas). `cte` says whether it's a CTE class (`always`, `sometimes`, `never`).
  AP, IB, Cambridge and college credit are college-level and count toward the load cap.
- **Ladders**: `math` (0 middle school, 1 Algebra I / Integrated I / Utah Secondary I, 2, 3, 4
  precalculus, 5 calculus, 6 beyond), `ela`, one per language, one per CTE cluster.
- **Same content and usual order**: `overlaps` lists classes that teach the same content (Personal
  Financial Literacy and Economics with Economics and with Personal Financial Literacy; the
  relation goes both ways), `usuallyAfter` a soft order the planner prefers but never
  enforces (music theory after band, choir or a music class), and `introTo` the classes an
  introductory class leads into (Exploring Computer Science is never suggested after Coding I).
- **Capabilities**: `alg2_or_beyond`, `advanced_math_after_alg2` and `lab_science`. Rules match types
  or capabilities, so Secondary Math III, Integrated Math III and Algebra II are equal only where a
  rule says so.
- **From a student row**: a linked school-list row's type, else the student's pick, else an exact
  title, else a name guess within the row's subject. A guess is *assumed*: it only matches
  `subjects` selectors, so it counts toward "3 science credits" but never makes "Chemistry" done.
- **Exact titles** (`exact-titles.ts`): a typed name that, after normalizing case, spaces,
  punctuation, numerals ("Algebra 1" is "Algebra I") and one H, Honors, AP, Pre-AP, CE or dual
  credit marker at its start or end, is the official or canonical title of exactly one kind in the
  student's state is that kind (source `exact`): it counts for requirements and needs no
  confirmation. The titles are the vocabulary's own names (a type's title where it names one class,
  its state titles, every language's I-IV) plus common names ("World Geography", "English 9") and
  each state's official titles from its saved sources (TEKS and TEA programs of study, Tennessee
  Policy 3.205, USBE's course list), all listed by `exactTitlesFor`. Never exact: a title two kinds
  share, a title joining two classes ("Gov/Econ", "Alg 2/Trig", "Personal Financial Literacy and
  Economics"), a catch-all ("Physical Education"), a kind outside the row's subject, and a level
  that could change the kind (Pre-AP is honors, never AP; the level must be one the kind is offered
  at and agree with the row's; an AP, IB or college-credit Biology, Chemistry, Physics or Calculus
  may be the second-year class). A marker sets the level of a row left at regular. Applied when rows
  are read, so nothing is stored or migrated.
- **Confirm first**: a guess never creates a claim by itself (a requirement missing, "doesn't
  fit", "needs a plan now", a "Required by" class the row might already be, or a different route).
  Requirements a guess decides read "Waiting on you to confirm a class", and "Confirm your classes"
  at the top of the path asks for each unconfirmed row's kind with the guess as one tap
  (`engine/confirm.ts`); exact titles aren't guesses and aren't asked about. The add and edit forms
  pre-select a confident guess (the exact kind, for an exact title: a test keeps the two in step),
  so saving confirms it.
- **Names the guesser reads carefully**: a name joining two classes ("Gov/Econ", "Economics &
  Personal Finance") is never a sure guess, and has both kinds as candidates; when both are
  half-credit kinds on a full-credit row, "Confirm your classes" offers it as two half-credit
  classes (`combinedHalves`; the row is split in two by `splitCombinedCourse` in
  `lib/courses/service.ts`). One class's own name that contains "and" (Integrated Physics and
  Chemistry, Personal Financial Literacy and Economics, U.S. History and Geography) stays one.
  Texas's PE courses by their TEKS names come before "wellness"; "Lifetime Wellness" is sure only
  in Tennessee, and any other wellness title is a guess among health, PE and wellness. A language
  class's level comes from its numeral first ("Pre-AP" is never AP).

To add a type, add an entry to `CORE` and run the tests (acyclic prerequisites, every ladder rung
reachable, and the coverage list for UT, TN, TX and the 32 families).

## Rule language (`rules.ts`)

Content lives in `src/content/planner/{ut,tn,tx}/{graduation,options,admissions,aid}.json`
(one `RuleFile` each), plus `generic-catalog.json` and `facts.json` per state, and
`src/content/planner/major-prep/{families,cip-routing,rigor}.json` (see the README there). Every file has `id`, `updated`,
`verifiedForSchoolYear`, `review` (`draft` or `counselor-reviewed` with the fingerprint), `sources`
and `citations` (verbatim quotes of 300 characters or fewer).

- **RuleSet**: `kind` (state graduation, graduation option, admission, program admission,
  guaranteed admission, state aid, college-credit program), `issuer` ("Required by Texas"),
  `strength` (the task's "status": required / strongly encouraged / recommended, plus `priority`
  for aid and `info`) quoted by `strengthCite`, `confidence`, `cohortKey`, `projectedBeyond`,
  `recheckBy`, `appliesWhen` (the gate), `variants` by cohort, and `testRoutes`.
- **Gates**: `appliesWhen.choice` (a Texas endorsement, the DLA via `txAimDla`, a Tennessee elective
  focus, a CTE pathway), `paths`, `colleges` (UNITIDs), `families`, `stateDefault`. Program gates
  are `program_admission` rule sets with colleges and families. Scholarship course parts are
  `state_aid` rule sets (for example a `count` requirement for Utah's Opportunity Scholarship).
- **Requirements** (`Req`): `credits`, `count`, `same_language`, `total_credits`,
  `remaining_electives`, and the groups `all`, `any`, `choose`, `option` (a family-chosen waiver or
  opt-out). Leaves must `cite`; any leaf can override its rule set's strength (quoted).
- **Selectors**: fields AND together, a requirement's list of selectors ORs. Assumed types never
  match `types` or `capabilities`.
- **Test routes**: `testRoutes` are quoted, never evaluated, and offered as the test-score option.
  An optional `by: { grade, month, day }` puts a dated route on the "by when" strip ("received by
  December 10 of 12th grade"), with the class route as a line under it rather than a gap. Optional
  `reqIds` limit a route to the requirements or checks it stands in for.
- **Only when done**: a credits leaf with `onlyWhenDone` (Utah calculus with a C) counts once
  finished and is never planned toward or reported as the route before that.
- **A question for an exception**: a credits leaf's `ask` (`select`, `question`, `cite`) is asked
  of the counselor whenever the student has a class matching `select` that the leaf doesn't count
  as the source states it (Utah: ENGL 1010 from 2026-27 counts for level 11 only "for students
  participating in an approved ENGL 1010 pilot"). With `decides` (`classes`, `text`), such a class
  may meet the requirement, but only the counselor can say (Tennessee's JROTC III for Personal
  Finance, when the JROTC instructor took the training): while the student has `classes` of them, a
  shortfall reads `text` and "Ask your counselor", never a class to add or "Needs a plan now".
- **Not course requirements**: `conditions` show as "We don't track this"; `unverified` shows once
  as "Ask your counselor"; `checks` run after allocation (math in 3 years, DLA on schedule by the
  end of 11th: the plan shows `req` and `with`, in any grade; Utah senior math, no Texas
  endorsement before the end of 10th, the DLA needs an endorsement, and `counts_unless`: a program
  that counts only while another rule set's requirements aren't met).
- **Projected and stale**: cohorts past `projectedBeyond` use the latest variant labeled
  Projected, never Done. Past `verifiedForSchoolYear` (July 31 after it) or `recheckBy`, lines read
  "being re-checked" and can't show Done. Dates never fail CI.

- **Information cards** (`RuleFile.infoCards`, admissions and aid files only): colleges with no
  course pattern to check, test policies, and scholarships decided by GPA and tests (Tennessee
  HOPE). Never evaluated; `confidence` other than "verified" reads as "Ask your counselor". A rule
  file may hold only cards.
- **State terms** (`FactsFile.terms`): what the state calls college credit, and words that mean
  something else there (Utah's "dual enrollment"). They agree with `STATE_LEVEL_LABELS`.
- **Rigor** (`RigorFile`, major-prep/rigor.json): one entry per `RIGOR_TIERS` tier (label, how it's
  detected, what those colleges expect, the planner's target, the earliest grade for college-level
  suggestions, how many rigor-first subjects), tier raises for program gates, and the guardrails.

The validator (`validate.ts`) parses every file and checks references, duplicate ids, cohort
overlaps and coverage for the classes of 2027-2034, the 256-alternative cap, review fingerprints,
the 32 families, hidden CIP routing rules, card placement, rigor tier order and family gates that
name rule sets. `npm run check:rules` adds citation coverage, strength words, quotes against saved
source copies (and live pages with `--live`), UNITIDs and CIP prefixes against the database,
staleness warnings and a diff summary.

## Engine contract (`engine-io.ts`)

`plan(input: PlannerInput): PathResult` is pure and deterministic, with plain JSON in and out and
the date in the input. The input holds the grade and cohort, the state (null means today's checklist,
unchanged), the class list per grade (school published, the family's own, or generic), the
student's classes (all locked), targets (path, up to 3 families, colleges), prefs (choices, limits,
dismissed suggestions) and the state's validated content.

The output is `no_state`, or a planned path with notices, what it was built from, "by when"
deadlines, pending decisions, at most 2 plans (typed), gaps with 1 to 3 options (typed; "ask your
counselor" last), the audit per rule set and requirement, demands (P0-P5), counselor questions, the
middle-school view, and every cited quote resolved. Each plan carries its own audit, gaps, "by
when" and counselor questions (the path's top-level ones are Plan A's, for summaries), so Plan B
never shows Plan A's gaps. Every line carries `Reason`s with citation ids.

`student_plan_prefs` stores `PlannerChoices`, `PlannerLimits` and `dismissed` (plus targets and cohort
overrides); like every new student table it must be in `exportStudentData` and deleted with the
student. Only what the student chose is stored: defaults (the limits, the inferred path, the DLA
on the degree path) are applied when reading, and the settings form saves only the fields the
student changed, so a later change to a default reaches everyone who never picked.

Invariants the engine keeps: it never edits the student's classes, never goes past
`maxCollegeLevelPerYear` (default 3; soft warning at 4), never scores anything by counting AP
classes, and never puts the school's name or id in the output. Catalog `title`s are local course
names for the student's own screens only; AI-facing summaries use `typeId`, `genericTitle` and
`level`.

## Proof-of-concept decisions reflected here

- No review gate. Draft content shows to everyone labeled "Not yet reviewed by a school counselor",
  and every plan says "Draft: take this to your school counselor." (`copy.ts`, `review.ts`).
- The load cap defaults to 3 college-level classes a year with a soft warning at 4. There's no
  Stretch option, and there's no rigor score.
- `txAimDla` defaults to true on the degree path, explained as the course route to automatic
  admission, with the test-score route still open (`TX_DLA_DEFAULT_NOTE`).
- A standing IEP/504/English-learner note is on every path, with no setting (`STANDING_PLAN_NOTE`).
- `graduationPageTitle` names the free "What <state> requires to graduate" pages.
- There's no Spanish in this phase, and no change to the counselor prompts.

## Decisions made by the content build

- CIP 51.1105 (pre-nursing) routes to nursing, in a rule placed before pre-health's 51.11.
- Utah "Modern Mathematics" isn't mapped to `math.other` (that would let any unknown math class
  count); the Secondary Math III opt-out requirement names it in a note instead.
- Where AP classes map (first-year type or the `*2` second-year type) follows the prerequisite the
  school prints; see each type's `note`.
