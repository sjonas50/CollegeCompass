import { Why } from "@/app/plan/path/why";
import type { ResolvedCitation } from "@/lib/planner/engine-io";
import type { Req } from "@/lib/planner/rules";
import { creditsText } from "@/lib/planner/view";

// A state's requirements as a readable list (the free graduation pages): each requirement's label,
// credits, the ways to meet it, and "Why?" with the source's own words.

/** Credits a requirement asks for, in quarter-credit units, when it's a fixed amount. */
export function reqUnits(req: Req): number | null {
  switch (req.kind) {
    case "credits":
    case "total_credits":
    case "remaining_electives":
      return req.units;
    case "all": {
      const parts = req.of.map(reqUnits);
      return parts.every((u): u is number => u !== null) ? parts.reduce((a, b) => a + b, 0) : null;
    }
    case "choose":
    case "any": {
      const parts = req.of.map(reqUnits);
      if (!parts.every((u): u is number => u !== null) || new Set(parts).size !== 1) return null;
      return req.kind === "choose" ? parts[0] * req.n : parts[0];
    }
    case "option":
      return reqUnits(req.off);
    default:
      return null;
  }
}

function amount(req: Req): string | null {
  if (req.kind === "count") return `${req.n} ${req.n === 1 ? "class" : "classes"}`;
  if (req.kind === "same_language") return `${req.levels} levels of one language`;
  const units = reqUnits(req);
  return units === null ? null : creditsText(units);
}

function children(req: Req): { lead: string; items: Req[] } | null {
  if (req.kind === "all") return { lead: "", items: req.of };
  if (req.kind === "any") return { lead: "One of these:", items: req.of };
  if (req.kind === "choose") return { lead: `Any ${req.n} of these:`, items: req.of };
  if (req.kind === "option") return { lead: "Usually:", items: [req.off] };
  return null;
}

function Item({ req, citations, depth }: { req: Req; citations: Record<string, ResolvedCitation>; depth: number }) {
  const sub = children(req);
  const qty = amount(req);
  const cite = "cite" in req && req.cite ? req.cite : [];
  const flatten = req.kind === "all" && req.of.length === 1;
  return (
    <li className={depth === 0 ? "border-t border-border py-2 first:border-t-0" : ""}>
      <div className="flex flex-wrap items-center gap-x-3">
        <p>
          <span className={depth === 0 ? "font-medium" : ""}>{req.label}</span>
          {qty && <span className="text-muted"> · {qty}</span>}
        </p>
        <Why ids={cite} citations={citations} label="Source" srContext={`for ${req.label}`} className="text-muted open:basis-full" />
      </div>
      {req.note && <p className="text-sm text-muted">{req.note}</p>}
      {req.kind === "option" && <p className="text-sm text-muted">A family can choose a different option here; ask the counselor.</p>}
      {sub && !flatten && (
        <>
          {sub.lead && <p className="mt-1 text-sm text-muted">{sub.lead}</p>}
          <ul className="mt-1 list-disc pl-5 text-sm">
            {sub.items.map((c) => (
              <Item key={c.id} req={c} citations={citations} depth={depth + 1} />
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

export function ReqTree({ reqs, citations }: { reqs: readonly Req[]; citations: Record<string, ResolvedCitation> }) {
  return (
    <ul>
      {reqs.map((r) => (
        <Item key={r.id} req={r} citations={citations} depth={0} />
      ))}
    </ul>
  );
}
