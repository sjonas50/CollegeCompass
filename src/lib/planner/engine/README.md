# Course planner engine

`plan(input: PlannerInput): PathResult` (design §5.1-5.13). Pure and deterministic: plain JSON in
and out, no database, no clock (the date is in the input), no randomness, no AI. Same input,
byte-identical output. Import it from `@/lib/planner/engine`. It uses `node:crypto` through the
contracts' `contentFingerprint`, so call it on the server (the `/plan` page renders once per request).

```ts
import { plan } from "@/lib/planner/engine";
const path = plan(await loadPlannerInput(db, userId)); // loadPlannerInput is built elsewhere
```

## Pipeline

| Step | File | What it does |
|---|---|---|
| Context | `context.ts` | Plan years (the current grade during the school year, the next one in June-July), the class list per grade (school list, else generic; unconfirmed subjects fall back to the generic list), rule sets that apply (gates, cohort variants, projected, stale, the labeled state default, the DLA default), major families, the rigor tier |
| Compile | `compile.ts` | Requirement trees to flat alternatives (`all` multiplies, `any` adds, `choose` combines, `option` follows the family's choice, substitutions add alternatives), extended variants joined in, 256 cap |
| Audit | `allocate.ts`, `flow.ts`, `audit.ts` | Min-cost max-flow in quarter-credit units; firm classes cost 1, planned 10, plus 0-5 for how broad a requirement is. Shareable requirements, counts and totals never use up credit; same-language requirements take their language classes first and share them. Statuses, modifiers, checks, conditions, diploma-vs-admission conflicts |
| Needs | `needs.ts` | Unmet requirements and major-prep targets become demands P0-P3 with windows and exclusive groups |
| Ladder | `ladder.ts` | Exact DP over (year, rung) for math: the student's rows are locked, one rung a year in Plan A, doubling up (only Algebra I+Geometry or Geometry+Algebra II) and summer only for options or an opted-in Plan B. Earliest/latest/slack; zero-slack steps are "by when" deadlines |
| Fill | `fill.ts` | Ladder, English each year, required language years (consecutive levels of one language) and a CTE pathway in order, then required (P0-P1) classes, then recommended language years (moving classes that fit elsewhere to free consecutive years), then P2-P3, most-constrained first with a merged score (one class serving several needs). Repair by moving lower-priority suggestions out (never one that also serves a need at the same priority); an exact bipartite check for P0, then P1, classes; rigor as level changes only; then pruning: suggestions no P0-P3 need still depends on are taken out |
| Gaps | `gaps.ts` | Unmet needs with at most three options from the fixed menu, "ask your counselor" last |
| Plans | `plan.ts` | Plan A, and Plan B only for a real choice: math route (opted in, B or better), two goals that don't both fit, a Texas endorsement not chosen yet, language vs. CTE. A Plan B never leaves more required needs unmet than Plan A |
| Words | `explain.ts`, `timeline.ts`, `questions.ts` | Reasons with citation ids on every line, the by-when strip, pending decisions, 3-8 counselor questions, resolved citations |

## Guarantees (pinned by `properties.test.ts`, `oracle.test.ts` and the golden tests)

- Never moves, changes or removes a class the student recorded; suggests around them.
- Never goes past a year's capacity or the student's college-level cap (default 3; the soft
  warning at 4 counts every class, whoever placed it). Never adds a college-level class to meet an
  ordinary requirement when a regular or honors class would; aid rules that need an AP/IB/CE class
  are met only by a level change on a class already planned, in 10th-11th.
- Nothing is suggested in grades 7-8 (middle school sees the placement card and a 9th-grade sketch
  in generic titles). No rigor changes in 12th. A current senior gets only required credits,
  flagged "Needs a plan now".
- Acceleration only with the opt-in and a B or better in the last math class: one math class a
  year otherwise, ladder or not (a senior's required credit aside).
- A failed or withdrawn rung with no retake isn't stood in for by a higher one: the retake comes
  first, and the student's own class above it counts once the retake is planned.
- A suggestion's "Required by" lines come only from the final audit's route, and only for
  requirements that would go short without it (and the classes that build on it); a class that's
  one way through a "choose" names the whole requirement ("Science (two of the five foundation
  science areas and one more science credit)"). Projected rules read "Expected by". A suggestion
  nothing needs any more is taken out, and one with nothing behind it reads as an idea for an
  open slot.
- A class typed with a name only (a guessed type) is planned around as if the guess were right:
  the fill never adds a second class of a kind the student probably has. The audit keeps the
  guess visible ("Guessed class type") and reports the route the guesses would meet.
- Credits never double-count inside an exclusive rule set, except where a rule shares them
  (`shareable`, a substitution, shared same-language levels).
- Prerequisites and grade availability of the list in use are respected (printed prerequisite
  loops and unresolved references are ignored and turned into a counselor question).
- The school's name, id and guide id never appear in the output; local course titles appear only
  in `title` fields for the student's own screens. `genericTitle`, demands, gaps, audit and
  counselor questions use generic type titles.
- Under 50 ms per plan, including a ~600-class school list.

## Interpretations (design choices the design left open)

- **Choosing an alternative.** The design says "most firm-met leaves, then on-track, then fewest
  missing units". Taken literally that prefers alternatives with more leaves and can pick a
  one-leaf alternative a student can't reach ("calculus with a C" for a student with no math).
  The engine ranks: never one with an unfinished `onlyWhenDone` leaf; reachable (math rungs within
  the years left from the student's own classes, never from suggestions; language levels offered
  with enough years left); fewest unmet requirements only an advanced level can meet (so an
  "AP-only" or "four advanced courses" route is never the default); fewest off-track requirements
  that name classes; for a graduation option's routes at most one class apart, the one whose
  missing requirement is a whole subject the goal is about (four fine arts credits for a graphic
  design goal, not four language levels); then their missing units (totals and "the rest in
  electives" only break ties); merge potential with the goals' classes and with what the other
  rule sets still ask for (Utah's "one more science" as the Physics Utah State recommends; every
  rule set picks its route a second time once all have one), and in the final audit the route
  that leans least on suggestions nothing else counts; fewest not yet done; author order. A base with extensions
  breaks ties by what its extensions still miss on each route (Tennessee's CS credit as the 4th
  math leaves Statistics for the elective focus). An extension (a Texas endorsement joining the
  Foundation program) follows its base's chosen alternative, including which requirement a
  substitution stands in for. In allocation a class goes first to a requirement that also stands
  in for another (the student's Computer Science Foundations is the CS credit, and the 4th math). A missing class that may stand in for another
  requirement (Tennessee's computer science credit) covers both: one need, not two.
- **`extends`** names a variant of another rule set; the student gets that rule set's variant for
  their own cohort (a 2025 entrant's endorsement joins the pre-2026 Foundation variant).
- **Deadlines.** A requirement's `deadlineGrade` limits which classes count (a summer class counts
  toward the next grade). A rule set with dated test routes shows the test date instead of the
  course deadline when the course route isn't planned.
- **Projected and conflicting rules** never show Done or Planned (always "Ask your counselor" with
  the modifier). Stale rules can't show Done. Projected aid rules create no demands.
- **`priority` strength** (TEXAS Grant) is information: it's audited but never creates a demand.
- **The year in progress** takes only required (P0) suggestions (and that grade's English or
  math when none is recorded), and only when no later year in the window can hold the class or
  the later years are needed for other required classes: its schedule is mostly set. A language
  class right after last year's level, and a pathway that needs every year left, can start there.
- **One math class a year**, ladder or not (Statistics isn't added next to Algebra II), unless the
  student opted in and their last math grade was a B or better. The next rung is preferred only
  for a need that names a rung or on the degree path; a plain "4th math" on the training or
  undecided path, including a senior's required credit there, prefers statistics or applied math.
  A degree-path senior's required credit is weighed by everything it serves (Algebra II for the
  DLA). An opted-in Plan B may take two college-credit math classes in one year (fall, then
  spring) where the state verifies college credit and the list has both.
- **Utah's senior-year math** (R277-700-9) is conditional: it reads "Utah asks college-bound students
  to show college-ready math or take a full year of math in 12th grade". A senior who passed
  calculus or hasn't said whether they met the competency is asked, not given a class flagged
  "Needs a plan now". The class chosen is the next rung or the goal's math (Statistics for
  nursing), never college-preparatory math after precalculus or for a goal of precalculus or
  calculus; for such a goal the next rung may be its AP or concurrent enrollment version (Utah's
  generic list has precalculus only as AP or CE 1050/1060). The ladder's top rung is left to a
  regular class from the fill (College Prep Math for Utah State's "one class beyond Secondary
  Math III") only when nothing but a recommendation needs it; then no rung's reason or "by when"
  line says it keeps that recommendation open.
- **Spread across years**: inside a class's usual grades, a year without a class in the same core
  subject (science, math, social studies) comes first, so junior year isn't stacked. A
  recommended class that would land outside its usual grades or make a third lab science in a
  year may use the "Your choice" slot, or move an elective-type class (the arts, PE, a career
  class) to another year. Moving classes to make room for a language never moves a core class a
  higher-priority need placed, and core classes move only within their usual grades. A language
  level goes in the year right after the last one: an elective-type class moves out, then the
  "Your choice" slot yields, before a year is skipped (and a skipped year says so).
- **Same content**: classes that teach the same content (`overlaps` in course-types: Personal
  Financial Literacy and Economics with Economics or Personal Financial Literacy) aren't
  suggested next to each other, and the fill picks the one that leaves room for a class another
  need names (Personal Financial Literacy when a business goal also wants Economics). A class
  that usually follows another (`usuallyAfter`: music theory after band, choir or a music class)
  comes after the others for a student without one.
- **Gap options** add load (summer, online, college credit, an exam) only for required needs and
  targets the student picked; a labeled default target's recommendation, a scholarship's course
  part or a career pathway's next level reads "Ask your counselor". For a math sequence, and for
  any math class when every year left already has one, they're acceleration: offered only with
  the opt-in and a B or better (otherwise the lower target and the counselor), and online names
  the rung that would be doubled, never the target. Options name a class the student can take
  next (not one they have, not a rung at or below theirs, prerequisites met); with none, only
  "Ask your counselor". A need that counts years (four years of math) gets no load options.
  College credit is offered only for a class that has a college-credit version, and for math only
  when two college classes in a year would actually close the gap. A total-credit shortfall lists
  the state's verified summer, online or exam options, and so does a program's own total on top
  of its base (a Texas endorsement's 26 credits, §74.13(c)) that the years left can't hold,
  "Needs a plan now" for a senior. Such a total also counts against the rule set when another
  one requires it (the DLA's endorsement). A class taken before 9th grade without high school
  credit (Algebra I in 8th) is one "ask your counselor whether it counts" gap, not a class to add.
- **Texas endorsement plans**: the goal's endorsement first (families.json, or the endorsement whose
  programs include the goal's or the student's current pathway), else the fewest added classes
  (Multidisciplinary Studies when there's no goal); STEM only for a STEM goal. A trial whose
  program counts only on a condition the plan doesn't meet (IT for Business and Industry while STEM's
  math and science are met) isn't offered. Where the two-plan choice doesn't apply (the training
  path, 11th grade, transfers) and no endorsement is named, the plan uses a default: the one the
  student's own career classes belong to, else Multidisciplinary Studies; the audit says so and
  the decision stays open. Seniors keep the Foundation plan, and the audit says that too. The
  choice reads "two that fit your goals" only when both endorsements come from the goals.
- **Utah Secondary Math III opt-out**: nothing from that rung is suggested; needs that depend on
  it become "your family opted out" gaps that only the counselor can settle.
- **A class on the same math rung** (Integrated Math I for a Texas "Algebra I" requirement) isn't
  suggested again; the requirement reads "Ask your counselor".
- **Generic lists** allow a class later than its usual grades (catching up), never earlier; the
  fill still prefers the usual grades. School lists' printed grades always win.
- **Career pathway levels** (`cte.<cluster>.<level>`) are never suggested twice, and a requirement
  met by CTE classes (a Texas endorsement's program of study) continues a pathway already in the
  plan before starting another, preferring the goal's own pathway and then clusters whose later
  levels the class list offers. A student who hasn't picked a pathway is planned in the one their
  own classes are in (two levels, or one on the training path).
- **Prerequisites of a cheaper level**: a college-level class isn't added when a regular or honors
  version of it could go in that grade, with its own prerequisites met (AP Computer Science A
  is suggested when Computer Science II would still need Computer Science I). A need with no
  class to place is tried once more after the next placement, which may add its prerequisite.
- **Middle school**: when the "by when" strip starts a rung in 8th, the 9th-grade sketch's math
  reads as the path without it ("If you don't take Algebra I in 8th: ...").
- **"Not for me"** holds everywhere a class can be placed, including English each year and the math
  ladder: another level of the same class is suggested instead, or the need becomes a gap.

## Tests

`testing/` holds test-only content (invented quotes on example.org, shaped like Appendix A and
validated by the contracts' validator), the golden scenarios (`scenarios.ts`, design §10.2), a
seeded random input generator and a plan summarizer for readable snapshots.
