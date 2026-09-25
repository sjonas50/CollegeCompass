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
| Fill | `fill.ts` | Ladder, English each year, languages as consecutive levels of one language, a CTE pathway in order, then P0-P3 by most-constrained first with a merged score (one class serving several needs). Repair by moving lower-priority suggestions out; an exact bipartite check for required classes; rigor as level changes only |
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
- Acceleration only with the opt-in and a B or better in the last math class.
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
  The engine ranks: reachable first (math rungs within the years left, language levels offered);
  fewest unmet requirements only college-level classes can meet (so an "AP-only" route is never
  the default); fewest open leaves; fewest off-track leaves; fewest missing units; merge potential
  with other targets; author order. An extension (a Texas endorsement joining the Foundation
  program) follows its base's chosen alternative.
- **`extends`** names a variant of another rule set; the student gets that rule set's variant for
  their own cohort (a 2025 entrant's endorsement joins the pre-2026 Foundation variant).
- **Deadlines.** A requirement's `deadlineGrade` limits which classes count (a summer class counts
  toward the next grade). A rule set with dated test routes shows the test date instead of the
  course deadline when the course route isn't planned.
- **Projected and conflicting rules** never show Done or Planned (always "Ask your counselor" with
  the modifier). Stale rules can't show Done. Projected aid rules create no demands.
- **`priority` strength** (TEXAS Grant) is information: it's audited but never creates a demand.
- **The year in progress** takes only required (P0) suggestions (and that grade's English or
  math when none is recorded), preferring any later year: its schedule is mostly set, but
  unrecorded required classes still show.
- **Utah Secondary Math III opt-out**: nothing from that rung is suggested; needs that depend on
  it become "your family opted out" gaps that only the counselor can settle.
- **A class on the same math rung** (Integrated Math I for a Texas "Algebra I" requirement) isn't
  suggested again; the requirement reads "Ask your counselor".
- **Generic lists** allow a class later than its usual grades (catching up), never earlier; the
  fill still prefers the usual grades. School lists' printed grades always win.

## Tests

`testing/` holds test-only content (invented quotes on example.org, shaped like Appendix A and
validated by the contracts' validator), the golden scenarios (`scenarios.ts`, design §10.2), a
seeded random input generator and a plan summarizer for readable snapshots.
