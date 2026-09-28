import { describe, expect, it } from "vitest";
import { type CourseTypeId } from "../course-types";
import type { Req, Selector } from "../rules";
import { evaluateAlternative } from "./allocate";
import type { Item } from "./model";
import { matchesAny } from "./select";
import { alternatives, item, variant } from "./testing/items";
import { pick, rng } from "./testing/random";

// The oracle (design §10.1): on tiny cases, a brute-force reference allocation checks the
// min-cost-flow audit. The reference tries every way to give each class to one requirement (or
// none), with whatever is left over going to electives, and keeps the most units counted.

const POOL: CourseTypeId[] = ["math.alg1", "math.geom", "math.alg2", "math.precalc", "sci.bio", "sci.chem", "sci.earth", "ss.us_gov", "ss.econ", "arts.visual"];
const SELECTORS: Selector[][] = [
  [{ types: ["math.alg1"] }],
  [{ types: ["math.geom", "math.alg2"] }],
  [{ capabilities: ["alg2_or_beyond"] }],
  [{ subjects: ["math"] }],
  [{ types: ["sci.bio"] }],
  [{ capabilities: ["lab_science"] }],
  [{ subjects: ["science"] }, { types: ["arts.visual"] }],
  [{ subjects: ["social_studies"] }],
];

type Case = { reqs: Req[]; items: Item[]; electives: number };

function randomCase(seed: number): Case {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 3);
  const reqs: Req[] = [];
  for (let i = 0; i < n; i++) reqs.push({ id: `r${i}`, label: `r${i}`, kind: "credits", units: pick(r, [2, 4, 4, 8]), select: pick(r, SELECTORS), cite: ["c"] });
  const electives = pick(r, [0, 0, 4, 8]);
  if (electives) reqs.push({ id: "electives", label: "electives", kind: "remaining_electives", units: electives, cite: ["c"] });
  const items: Item[] = [];
  for (let i = 0; i < 2 + Math.floor(r() * 4); i++) {
    items.push(item(pick(r, POOL), { units: pick(r, [1, 2, 4, 4]), status: pick(r, ["completed", "in_progress", "planned"] as const), id: `o${seed}-${i}` }));
  }
  return { reqs, items, electives };
}

/** Most units a valid allocation can count (each class: one requirement plus electives). */
function bruteForce({ reqs, items, electives }: Case): number {
  const specific = reqs.filter((q): q is Extract<Req, { kind: "credits" }> => q.kind === "credits");
  let best = 0;
  const choice: number[] = new Array(items.length).fill(-1);
  const visit = (i: number) => {
    if (i === items.length) {
      const given = specific.map(() => 0);
      items.forEach((it, k) => {
        if (choice[k] >= 0) given[choice[k]] += it.units;
      });
      const used = specific.reduce((sum, q, j) => sum + Math.min(q.units, given[j]), 0);
      const leftover = items.reduce((s, it) => s + it.units, 0) - used;
      best = Math.max(best, used + Math.min(electives, leftover));
      return;
    }
    choice[i] = -1;
    visit(i + 1);
    specific.forEach((q, j) => {
      if (matchesAny(items[i], q.select)) {
        choice[i] = j;
        visit(i + 1);
      }
    });
    choice[i] = -1;
  };
  visit(0);
  return best;
}

describe("audit oracle", () => {
  it("counts as many units as the best allocation a brute-force search finds", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const c = randomCase(seed);
      const [alt] = alternatives(variant(c.reqs));
      const result = evaluateAlternative(alt, c.items, "exclusive");
      const counted = result.leaves.reduce((s, l) => s + l.firm + l.planned, 0);
      expect(counted, `seed ${seed}`).toBe(bruteForce(c));
    }
  });

  it("produces valid allocations: matches, capacities, and one requirement per class besides electives", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const c = randomCase(seed);
      const [alt] = alternatives(variant(c.reqs));
      const result = evaluateAlternative(alt, c.items, "exclusive");
      const perItem = new Map<string, { units: number; specific: Set<string> }>();
      for (const l of result.leaves) {
        const total = l.counted.reduce((s, x) => s + x.amount, 0);
        expect(total, `seed ${seed} ${l.leaf.id}`).toBeLessThanOrEqual(l.required);
        for (const x of l.counted) {
          if (l.leaf.req.kind === "credits") expect(matchesAny(x.item, l.leaf.req.select), `seed ${seed}`).toBe(true);
          const entry = perItem.get(x.item.key) ?? { units: 0, specific: new Set<string>() };
          entry.units += x.amount;
          if (l.leaf.req.kind !== "remaining_electives") entry.specific.add(l.leaf.id);
          perItem.set(x.item.key, entry);
        }
      }
      for (const [key, e] of perItem) {
        const it = c.items.find((x) => x.key === key)!;
        expect(e.units, `seed ${seed} ${key}`).toBeLessThanOrEqual(it.units);
        expect(e.specific.size, `seed ${seed} ${key}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("prefers finished classes: never counts a planned class where an unused finished one would do", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const c = randomCase(seed);
      const [alt] = alternatives(variant(c.reqs));
      const result = evaluateAlternative(alt, c.items, "exclusive");
      const usedUnits = new Map<string, number>();
      for (const l of result.leaves) for (const x of l.counted) usedUnits.set(x.item.key, (usedUnits.get(x.item.key) ?? 0) + x.amount);
      for (const l of result.leaves) {
        if (l.leaf.req.kind !== "credits" || l.planned === 0) continue;
        const req = l.leaf.req;
        const idleFirm = c.items.filter((i) => i.firm && matchesAny(i, req.select) && (usedUnits.get(i.key) ?? 0) === 0);
        expect(idleFirm.map((i) => i.key), `seed ${seed} ${l.leaf.id}`).toEqual([]);
      }
    }
  });

  it("checks independent requirements on their own", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const c = randomCase(seed);
      const reqs = c.reqs.filter((q) => q.kind === "credits");
      if (reqs.length === 0) continue;
      const [alt] = alternatives(variant(reqs, "independent"));
      const result = evaluateAlternative(alt, c.items, "independent");
      for (const l of result.leaves) {
        const req = l.leaf.req as Extract<Req, { kind: "credits" }>;
        const available = c.items.filter((i) => matchesAny(i, req.select)).reduce((s, i) => s + i.units, 0);
        expect(l.firm + l.planned, `seed ${seed}`).toBe(Math.min(req.units, available));
      }
    }
  });
});
