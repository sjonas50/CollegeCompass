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
| Context | `context.ts`, `guesses.ts` | Plan years (the current grade during the school year, the next one in June-July), the class list per grade (school list, else generic; unconfirmed subjects fall back to the generic list), rule sets that apply (gates by family or by a goal's major CIP code, cohort variants, projected, stale, the labeled state default, the DLA default), major families, the rigor tier, and typed rows the name didn't place taken as the class their grade says they are |
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
  science areas and one more science credit)"). Suggestions that could stand in for each other
  (Chemistry, and a Physics a college only recommends, for Utah's "one more science credit") don't
  cancel each other out: the class the route counts carries the requirement. Projected rules read
  "Expected by". A suggestion nothing needs any more is taken out, and one with nothing behind it
  reads as an idea for an open slot (never one placed for a required credit).
- **Confirm first** (`confirm.ts`): a class typed with a name only (a guessed type) never creates a
  claim by itself: no requirement shortfall, "doesn't fit" or "needs a plan now" gap, no "Required
  by" class that repeats what the row might be, and no different route (an endorsement from guessed
  career classes, a pathway, a Plan B). Each unconfirmed row knows every kind it might be (the
  guesser's `candidates`: its guess, another rung its name names, the family a catch-all stands for,
  or any kind in its subject near its grade for a name the guesser can't place). The engine uses the
  guess only where it can't make a false claim: to pick the next math rung, and (planning with
  `asPlanned`) never to add a class the student probably has. A requirement a guess decides (met
  only by counting it, or short while a row might count) reads "Waiting on you to confirm a class"
  (`waiting_confirm`: not met, not missing), gets no class added for it and no gap, and its "by
  when" line waits too. A requirement still short with its guesses counted, where no row might make
  up the rest, is really short. Guessed kinds never add a claim the same kinds, confirmed, wouldn't
  make (pinned over random and misguessed students, `review-fixes-9.test.ts`). The path lists the
  unconfirmed rows (`confirm`) for "Confirm your classes", and the counselor questions always keep
  one line about them.
- Credits never double-count inside an exclusive rule set, except where a rule shares them
  (`shareable`, a substitution, shared same-language levels). A kind of class that may stand in
  only once (`substituteOnce`: Tennessee's computer science for "one (1) credit in mathematics,
  or one (1) credit in science", Policy 2.103 I(4)(b)1) keeps its substitute selectors on one of
  the requirements it names per compiled route.
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
  "Needs a plan now", and so is a student taking a concurrent enrollment math class that meets the
  college quantitative literacy requirement (a C in it may already show college-ready math), in any
  grade. The class chosen is the goal's math (Statistics for nursing) or the next rung; past
  precalculus's rung, calculus only for a goal that asks for it (statistics or quantitative
  reasoning first), and never calculus after College Algebra alone (it needs precalculus or
  trigonometry, Utah's Math 1060). Never college-preparatory math after precalculus or for a goal
  of precalculus or calculus; for such a goal the next rung may be its AP or concurrent enrollment version (Utah's
  generic list has precalculus only as AP or CE 1050/1060). The ladder's top rung is left to a
  regular class from the fill (College Prep Math for Utah State's "one class beyond Secondary
  Math III") only when nothing but a recommendation needs it; then no rung's reason or "by when"
  line says it keeps that recommendation open. Any suggested 12th-grade math class the check
  counts says so, whatever it was placed for (Precalculus for the sequence is also the senior
  math).
- **The audit's route** follows the reroute's program exclusions only (a `counts_unless` program
  planned again without it), never the requirements the fill gave up on: Utah's Secondary Math I
  for a transfer past that rung stays an "ask your counselor" line, and a route whose only open
  line counts once calculus is passed is never the one reported when another is open.
- **Spread across years**: inside a class's usual grades, a year without a class in the same core
  subject (science, math, social studies) comes first, so junior year isn't stacked. Required
  classes with the fewest years inside their usual grades are placed first (World History's 9th-10th
  before U.S. History's 10th-11th before ACGC's 10th-12th), a required class stays in its usual
  grades before it pairs with another semester class, and one that would land outside them moves
  an elective-type class (art, PE, a career class) or a lower-priority career pathway level (a year
  later, levels still in order) out of a usual year first (U.S. History, with its end-of-course
  exam, in 11th rather than senior spring). A last pass moves a required class back into its usual
  grades when a year there has room by the end. A
  recommended class that would land outside its usual grades or make a third lab science in a
  year may use the "Your choice" slot, or move an elective-type class (the arts, PE, a career
  class) to another year. Moving classes to make room for a language never moves a core class a
  higher-priority need placed, and core classes move only within their usual grades. A language
  level goes in the year right after the last one: an elective-type class moves out, then the
  "Your choice" slot yields, before a year is skipped (and a skipped year says so).
- **Retakes**: a class the student didn't pass (F, W or I) is planned again in a later grade,
  English I-IV included (a second English class that year), never as its AP or college version;
  where the state has credit recovery (Tennessee Policy 2.103 VI), the slot and the gap name it,
  and a summer retake isn't held to the first-attempt note. A required class goes into a year in
  progress the student has recorded only when no later year can take it, even in place of a
  recommended or major-prep suggestion.
- **Routes through a choice**: among a graduation option's program routes, the goal's own career
  pathway wins over routes that only overlap other targets (Education and Training for a future
  teacher's Public Services endorsement); the slot names the whole requirement ("one way: …") and
  offers the other programs' first classes as Other choices. Other choices never drop a required
  class the suggestion is needed for: each counts for that requirement itself, or, swapped in,
  keeps the route met or meets another route as well (Physics for Chemistry among Utah's science
  areas), or is another program's class at the same step. A sibling in the same route (Speech for
  a required World History in "four credits in each core subject") never is, and a retake's
  choices are never AP or college classes. A requirement of the program an option builds on is
  named only when the base program's own route counts the class there.
- **Opt-outs**: after Utah's Secondary Math III opt-out, targets past that rung leave the ladder,
  which plans Secondary Math II by 10th and then the applied class (the generic list gives Utah's
  applied statistics and financial math Secondary Math II as a prerequisite).
- **Same content**: classes that teach the same content (`overlaps` in course-types: Personal
  Financial Literacy and Economics with Economics or Personal Financial Literacy) aren't
  suggested next to each other, and the fill picks the one that leaves room for a class another
  need names (Personal Financial Literacy when a business goal also wants Economics). A class
  that usually follows another (`usuallyAfter`: music theory after band, choir or a music class)
  comes after the others for a student without one.
- **Two goals that don't fit**: each plan follows only its own goal's program gates and admission
  rules (Texas A&M engineering's math isn't part of the nursing plan), and the split is offered
  only when a goal's classes that didn't fit next to the other's fit in its own plan. In Texas,
  when the student hasn't named an endorsement and the two-plan endorsement choice isn't what
  separates the plans, each plan uses its goal's endorsement for now (nursing's Public Services,
  engineering's STEM; 19 TAC §74.11(f)), and the audit says so.
- **Recommendations over major prep** (design §5.6): a recommended (P2) class with no room takes
  the place of a lower-priority suggestion in a year it can go in (Physics for a career pathway's
  level 3), when everything ranked with or above it stays as met. Where a planned class that
  can't give way holds the slot, the gap names the swap instead ("Precalculus in place of
  Statistics in 12th grade would meet this"), only after checking it on the plan: with the swap
  applied, every rule set on its audit route, the checks and the goals' targets must miss less of
  that need, and nothing ranked with or above it, and no required (P0-P1) need, may miss more (so
  never Statistics in place of a Texas student's only Algebra II, a half credit for another half
  credit, or a class the family opted out of).
- **College-level load**: level changes for a requirement only AP or IB classes meet go in the
  year with the fewest college-level classes, and a core class's AP version in its usual grade
  (AP U.S. History not in 10th); a college-level class the fill places prefers the lighter year.
- **Math below the student's**: applied, algebraic-reasoning, college-readiness and quantitative
  reasoning classes are never suggested to a student who has reached precalculus.
- **Math sequences**: Other choices never switch a student's sequence mid-way (Integrated Math III
  after Algebra I and Geometry, or Algebra II after Integrated Math I and II).
- **UT Austin's class route**: the note under the test date names the moves that would reach
  Calculus I by the end of 11th grade (a summer class where the state has one, two math classes in
  a year, two college-credit classes in a year), re-solving the ladder, and only when they reach
  it; otherwise it says the class route can't be finished and that a fall 12th-grade college class
  counts only if graded by December 10.
- **Gap options** add load (summer, online, college credit, an exam) only for required needs and
  targets the student picked; a labeled default target's recommendation, a scholarship's course
  part or a career pathway's next level reads "Ask your counselor". For a math sequence, and for
  any math class when every year left already has one, they're acceleration: offered only with
  the opt-in and a B or better (otherwise the lower target and the counselor), and online names
  the rung that would be doubled, never the target. Options name a class the student can take
  next (not one they have, not a rung at or below theirs, prerequisites met); with none, only
  "Ask your counselor". A need that counts years (four years of math) gets no load options.
  Where the state keeps first-time summer classes for accelerated students (Tennessee,
  `firstAttemptAccelerated`), summer is offered for a first attempt only with the opt-in, and
  otherwise only as a retake.
  College credit is offered only for a class that has a college-credit version, and for math only
  when two college classes in a year would actually close the gap. Credit totals count the year
  in progress only for its spring term (half a credit per open period: its schedule is mostly set,
  and an open period may earn no credit); when only the whole year's open periods would hold the
  total, the gap says it fits only if classes are added this year. A shortfall the years after
  this one can't hold is a gap for any grade ("Room to add: total credits needs 3 more, and the
  years after this one have room for about 2.5. Add 0.5 credits this spring (your open periods)"),
  unless a non-senior's year in progress has two or more open periods (its classes may not all be
  recorded yet). A total-credit shortfall lists
  the state's verified summer, online or exam options, and so does a program's own total on top
  of its base (a Texas endorsement's 26 credits, §74.13(c)) that the years left can't hold,
  "Needs a plan now" for a senior. A senior's only room is this spring's open periods, so any
  shortfall is a gap ("Needs a plan now: … Add 1 credit this spring (your open periods)"), and
  counts against the rule sets that require that program until classes on the plan cover it. Such a total also counts against the rule set when another
  one requires it (the DLA's endorsement). A class taken before 9th grade without high school
  credit (Algebra I in 8th) is one "ask your counselor whether it counts" gap, not a class to add.
- **Texas endorsement plans**: the goal's endorsement first (families.json, or the endorsement whose
  programs include the goal's or the student's current pathway), else the fewest added classes
  (Multidisciplinary Studies when there's no goal); STEM only for a STEM goal. A trial whose
  program counts only on a condition the plan doesn't meet (IT for Business and Industry while STEM's
  math and science are met) isn't offered, and for an endorsement the student named, the plan is
  built again without that program when another fits as well. Where the two-plan choice doesn't apply (the training
  path, 11th grade, transfers) and no endorsement is named, the plan uses a default: the
  endorsement of the career pathway the student chose, or the one their own career classes are
  in, or on the training path the goal's Texas pathway the plan places (Business and Industry for
  an electrician's construction program), else Multidisciplinary Studies; the audit says so and
  the decision stays open. Seniors keep the Foundation plan, and the audit says that too. The
  choice reads "two that fit your goals" only when both endorsements come from the goals.
- **Utah Secondary Math III opt-out**: nothing from that rung is suggested; needs that depend on
  it become "your family opted out" gaps that only the counselor can settle.
- **A class on the same math rung** (Integrated Math I for a Texas "Algebra I" requirement) isn't
  suggested again; the requirement reads "Ask your counselor", never "Needs a plan now" for a
  senior (nor does a class from before 9th grade without high school credit, or one the family
  opted out of). No class is added for a requirement those classes may meet (Secondary Math III
  for Texas's 3rd math credit), and one counselor question names each of the student's classes
  and the line it may stand for.
- **Typed names the guesser can't place** (a row that fell to its subject's "Other" class) are
  taken as the class their place says they are, still flagged as guesses: an "Other English
  class" in 9th-12th with no English level that year is that grade's English, and an "Other math
  class" in a year without a math rung is the next rung (I-III, in its usual grade or a year
  later), never a rung the family opted out of (Utah's Secondary Math III). The row shows "We
  planned around this as …", and the guessed-kinds question asks.
- **Language levels** count levels filled, not exact ranks: each class fills one level at or below
  its own, so Spanish I and III (or heritage Spanish and Spanish III) are two levels, and a placed
  Spanish III alone is one. The next level suggested is always the one up from the student's
  highest (Spanish IV after Spanish III, "IV or higher" again past it), in the plan and in options.
- **A blocked class gets another try** once pruning frees room (a class placed for a route the plan
  gave up on), so "doesn't fit" is never said of a year that has room. A gap for a class the year in
  progress had room for says to ask about adding it now, not that it doesn't fit.
- **Credits left for 12th grade**: a graduation or endorsement total that fits only with classes in
  12th's open periods (where the plan shows no "Your choice" slot) is a gap that says how many to plan
  there ("a shorter senior day could leave you short").
- **Generic lists** allow a class later than its usual grades (catching up), never earlier; the
  fill still prefers the usual grades. School lists' printed grades always win.
- **Career pathway levels** (`cte.<cluster>.<level>`) are never suggested twice, and no level at or
  below where the student is in a cluster (`pastCteLevel`) is suggested for any need (an
  endorsement's program of study included; where only such levels are listed, the next level is a
  question for the counselor, and the endorsement doesn't switch programs for it). A requirement
  met by CTE classes (a Texas endorsement's program of study) continues a pathway already in the
  plan before starting another, preferring the goal's own pathway and then clusters whose later
  levels the class list offers. A student who hasn't picked a pathway is planned in the one their
  own classes are in (two levels, or one on the training path). Levels go in order: a student who
  reached a level (Accounting II is level 3 in business) is never sent back to a lower one, and
  typed names carry their level (TEA's programs of study: Welding I is level 2, Instructional
  Practices level 3, Practicum in Health Science level 4, Electrical Technology I level 2,
  Automotive Technology I level 3; Tennessee's Medical Therapeutics level 2). The next level is the
  student's highest level plus one (two level-1 classes lead to level 2, never level 3 without it).
  Only where names can't tell levels apart (Tennessee's Engineering Design I and II are one
  lab-science substitute type, a career class off the ladder) do classes count one level a year: no
  level at or below the number of years the student has had classes in the cluster is planned, and
  they meet a later level's prerequisite. Only classes whose kind the student confirmed set the
  pathway or a Texas endorsement.
- **Waived credits that expand a focus** (Tennessee, `expands`) are counted in the focus's joined
  allocation, beyond the focus's own classes, and never planned: a shortfall is a gap whose only
  option is the counselor. With no focus chosen they read "Ask your counselor".
- **Counselor questions**: guessed class kinds are one question, asked last, and only for guessed
  rows a requirement counts. A requirement's `ask` (Utah's ENGL 1010 pilot) is asked when the
  student has a class it names. A college-credit class brings up only family notes marked
  `collegeCredit`, a college's own only when it's on the list.
- **Prerequisites of a cheaper level**: a college-level class isn't added when a regular or honors
  version of it could go in that grade, with its own prerequisites met (AP Computer Science A
  is suggested when Computer Science II would still need Computer Science I). A need with no
  class to place is tried once more after the next placement, which may add its prerequisite.
- **Middle school**: when the "by when" strip starts a rung in 8th, the 9th-grade sketch's math
  reads as the path without it ("If you don't take Algebra I in 8th: ...").
- **Doubling up** only for a pair the state or the list allows (design §5.6): Texas's Algebra I
  with Geometry (a `double_up` fact), or a list that prints a rung as taken with the one below it.
- **First classes of their kind**: a first Biology or Chemistry, and a student's first art or music
  theory class (Art I and II come before AP Art and Design), stay regular or honors: no rigor level
  change or AP/IB focus credit makes them AP.
- **The year in progress**: a semester class added to it goes in spring, and a full-year one says
  to ask the counselor whether it can still be added.
- **Middle school**: the exploration list starts with the goal's career cluster, from another
  state's pathway where the state lists none for the goal (Tennessee).
- **"Not for me"** holds everywhere a class can be placed, including English each year and the math
  ladder: another level of the same class is suggested instead, or the need becomes a gap.

## Tests

`testing/` holds test-only content (invented quotes on example.org, shaped like Appendix A and
validated by the contracts' validator), the golden scenarios (`scenarios.ts`, design §10.2), a
seeded random input generator and a plan summarizer for readable snapshots.
