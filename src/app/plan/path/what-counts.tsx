import type { ReactNode } from "react";
import type { CourseStatus } from "@/db/schema";
import { findRuleSet, infoCardsForCollege, majorFamiliesContent, resolveContentCitations, stateInfoCards } from "@/lib/planner/content";
import { AUDIT_MODIFIER_LABELS, SUGGESTION_LABEL } from "@/lib/planner/copy";
import type { CountedRef, PlannedPath, RequirementAudit, RuleSetAudit } from "@/lib/planner/engine-io";
import { getFamily } from "@/lib/planner/families";
import { REVIEW_LABELS } from "@/lib/planner/review";
import type { InfoCard } from "@/lib/planner/rules";
import type { PathContext } from "@/lib/planner/service";
import { type AuditGroupId, auditGroup, COURSE_STATUS_WORDS, ordinal, progressText, statusWord, strengthLine, suggestionsByKey } from "@/lib/planner/view";
import { Chip, PathSection, StatusBadge } from "./parts";
import { Why } from "./why";

// "What counts toward what" (design §2.7 item 6): each rule set that applies, who asks for it and
// how strongly, its status, the classes that count, and the source's own words. Non-course
// requirements read "We don't track this"; anything unconfirmed reads "Ask your counselor".

type CountedName = { name: string; status: CourseStatus | "suggested"; grade: number | null };

function countedNames(path: PlannedPath, ctx: PathContext) {
  const byKey = suggestionsByKey(path);
  const byId = new Map(ctx.courses.map((c) => [c.id, c]));
  return (ref: CountedRef): CountedName | null => {
    if (ref.kind === "course") {
      const c = byId.get(ref.courseId);
      return c ? { name: c.name, status: c.status, grade: c.gradeLevel } : null;
    }
    const base = ref.key.replace(/#\d+$/, "");
    const s = byKey.get(ref.key) ?? byKey.get(base);
    return s ? { name: s.title, status: "suggested", grade: s.grade } : null;
  };
}

function Requirement({ req, name, citations }: { req: RequirementAudit; name: (ref: CountedRef) => CountedName | null; citations: PlannedPath["citations"] }) {
  const counted = req.counted.flatMap((c) => {
    const n = name(c.ref);
    return n ? [n] : [];
  });
  const statuses = counted.flatMap((c) => (c.status === "suggested" ? [] : [c.status]));
  const reasonIds = req.reasons.flatMap((r) => r.citations);
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="font-medium">{req.label}</span>
        <StatusBadge status={req.status} word={statusWord(req.status, statuses)} />
      </div>
      <p className="text-sm text-muted">{progressText(req)}</p>
      {req.modifiers.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-1">
          {req.modifiers.map((m) => (
            <Chip key={m} tone="note">
              {AUDIT_MODIFIER_LABELS[m]}
            </Chip>
          ))}
        </p>
      )}
      {counted.length > 0 && (
        <p className="mt-1 text-sm">
          <span className="text-muted">Counts: </span>
          {counted
            .map((c) => `${c.name} (${c.status === "suggested" ? `suggested${c.grade ? `, ${ordinal(c.grade)}` : ""}` : COURSE_STATUS_WORDS[c.status].toLowerCase()})`)
            .join("; ")}
        </p>
      )}
      {req.conflicts.map((c, i) => (
        <p key={i} className="mt-1 rounded-lg border border-dashed border-border px-3 py-2 text-sm">
          {c.text}
        </p>
      ))}
      <Why ids={reasonIds} citations={citations} srContext={`for ${req.label}`} />
    </li>
  );
}

function RuleSetCard({ rs, path, name }: { rs: RuleSetAudit; path: PlannedPath; name: (ref: CountedRef) => CountedName | null }) {
  const content = findRuleSet(rs.ruleSetId);
  const built = path.builtFrom.ruleSets.find((r) => r.id === rs.ruleSetId);
  const review = rs.review === "counselor-reviewed" && built?.reviewedOn ? `Reviewed by a school counselor on ${built.reviewedOn}` : REVIEW_LABELS.draft;
  const extra = resolveContentCitations(content ? [content.ruleSet.strengthCite] : []);
  const citations = { ...extra, ...path.citations };
  return (
    <details className="group rounded-xl border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-start justify-between gap-2 rounded-xl p-4 focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 basis-56">
          <span className="block font-medium">{rs.title}</span>
          <span className="block text-sm text-muted">
            {strengthLine(rs.strength, rs.issuer)}
            {rs.projected && " · Projected"}
            {rs.stale && " · Being re-checked"}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <StatusBadge status={rs.status} word={statusWord(rs.status)} />
          <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
            ▾
          </span>
        </span>
      </summary>
      <div className="space-y-4 border-t border-border p-4 text-sm">
        {content && <p>{content.ruleSet.plainSummary}</p>}
        <p className="text-muted">{review}.</p>
        {rs.projected && (
          <p className="rounded-lg border border-dashed border-border px-3 py-2">
            Projected: the rules for your class aren&apos;t published yet, so this uses the latest ones. It can&apos;t show as done;
            ask your counselor.
          </p>
        )}
        {rs.confidence !== "verified" && (
          <p className="rounded-lg border border-dashed border-border px-3 py-2">
            {rs.confidence === "conflicting" ? "Sources disagree about these rules." : "We couldn't confirm these rules."} Ask your counselor.
          </p>
        )}
        {rs.requirements.length > 0 && (
          <ul>
            {rs.requirements.map((req) => (
              <Requirement key={req.reqId} req={req} name={name} citations={citations} />
            ))}
          </ul>
        )}
        {rs.checks.length > 0 && (
          <ul className="space-y-1">
            {rs.checks.map((c) => (
              <li key={c.checkId}>
                <StatusBadge status={c.status === "ok" ? "done" : c.status} word={c.status === "ok" ? "Looks right" : statusWord(c.status)} />{" "}
                {c.text}
              </li>
            ))}
          </ul>
        )}
        {rs.testRoutes.map((t) => (
          <div key={t.id}>
            <p>
              <span className="font-medium">Test-score route: </span>
              {t.text}
            </p>
            <Why ids={t.citations} citations={citations} srContext="for the test-score route" />
          </div>
        ))}
        {rs.conditions.length > 0 && (
          <div>
            <p className="font-medium">Also needed (not classes). We don&apos;t track these:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {rs.conditions.map((c) => (
                <li key={c.id}>
                  {c.label}
                  <Why ids={c.citations} citations={citations} srContext={`for ${c.label}`} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {rs.unverified.length > 0 && (
          <div>
            <p className="font-medium">Ask your counselor:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {rs.unverified.map((u) => (
                <li key={u.id}>{u.text}</li>
              ))}
            </ul>
          </div>
        )}
        {rs.warnings.length > 0 && (
          <div>
            <p className="font-medium">Good to know:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {rs.warnings.map((w) => (
                <li key={w.id}>
                  {w.text}
                  <Why ids={w.citations} citations={citations} srContext="for this note" />
                </li>
              ))}
            </ul>
          </div>
        )}
        {content && (
          <Why ids={[content.ruleSet.strengthCite]} citations={citations} label={`Why “${strengthLine(rs.strength, rs.issuer).toLowerCase()}”?`} />
        )}
      </div>
    </details>
  );
}

function InfoCards({ cards }: { cards: InfoCard[] }) {
  if (!cards.length) return null;
  const citations = resolveContentCitations(cards.flatMap((c) => c.cite));
  return (
    <ul className="space-y-2">
      {cards.map((card) => (
        <li key={card.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
          <p className="font-medium">{card.title}</p>
          <p className="mt-1">{card.text}</p>
          {card.confidence !== "verified" && <p className="mt-1 text-muted">We couldn&apos;t confirm all of this. Ask your counselor.</p>}
          <Why ids={card.cite} citations={citations} srContext={`for ${card.title}`} />
        </li>
      ))}
    </ul>
  );
}

function Group({ id, title, lead, children }: { id: AuditGroupId | "prep"; title: string; lead?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`counts-${id}`} className="space-y-2">
      <h4 id={`counts-${id}`} className="font-medium">
        {title}
      </h4>
      {lead && <p className="text-sm text-muted">{lead}</p>}
      {children}
    </section>
  );
}

function MajorPrep({ path, planId }: { path: PlannedPath; planId: "A" | "B" }) {
  const families = path.builtFrom.families;
  const content = majorFamiliesContent().families;
  // The suggestions in the plan on screen (Plan A or B), once each.
  const shown = path.plans.find((p) => p.id === planId) ?? path.plans[0];
  const inPlan = (shown?.years ?? [])
    .flatMap((y) => y.slots.flatMap((s) => (s.kind === "suggested" ? [{ ...s, grade: y.grade }] : [])))
    .filter((s, i, all) => all.findIndex((o) => o.title === s.title && o.grade === s.grade) === i);
  if (!families.length) {
    return (
      <p className="text-sm text-muted">
        Pick a north star career (or choose a kind of major in “Your choices” below) and we&apos;ll add the classes that
        prepare you for it.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {families.map((f, i) => {
        const fc = content.find((c) => c.id === f.familyId);
        const planned = inPlan.filter((s) => s.reasons.some((r) => r.familyId === f.familyId));
        const gaps = path.gaps.filter((g) => g.reasons.some((r) => r.familyId === f.familyId));
        const listed = new Set(path.builtFrom.colleges.flatMap((c) => (c.unitId ? [c.unitId] : [])));
        const notes = [
          ...(fc?.gates ?? []).filter((g) => !g.colleges || g.colleges.some((u) => listed.has(u))).map((g) => ({ id: g.id, text: g.text, cite: g.cite })),
          ...(fc?.cautions ?? []),
        ];
        const citations = resolveContentCitations([...(fc?.math.cite ?? []), ...notes.flatMap((n) => n.cite)]);
        return (
          <li key={f.familyId} className="rounded-xl border border-border bg-surface p-4 text-sm">
            <p className="font-medium">
              {getFamily(f.familyId).title}
              {i > 0 && <span className="font-normal text-muted"> (also check)</span>}
            </p>
            <p className="text-muted">
              {f.because ? `Because you picked ${f.because}. ` : f.source === "chosen" ? "You chose this. " : ""}
              {SUGGESTION_LABEL}.
            </p>
            {fc && <p className="mt-1">{fc.summary}</p>}
            {planned.length > 0 && (
              <p className="mt-1">
                <span className="text-muted">In your path: </span>
                {planned.map((s) => `${s.title} (${ordinal(s.grade)})`).join("; ")}
              </p>
            )}
            {gaps.map((g) => (
              <p key={g.id} className="mt-1">
                {g.text}
              </p>
            ))}
            {notes.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {notes.map((n) => (
                  <li key={n.id}>{n.text}</li>
                ))}
              </ul>
            )}
            <Why ids={[...(fc?.math.cite ?? []), ...notes.flatMap((n) => n.cite)]} citations={citations} srContext={`for ${getFamily(f.familyId).title}`} />
          </li>
        );
      })}
    </ul>
  );
}

export function WhatCounts({ path, ctx, planId = "A" }: { path: PlannedPath; ctx: PathContext; planId?: "A" | "B" }) {
  const name = countedNames(path, ctx);
  const cards = stateInfoCards(path.state);
  const collegeCards = path.builtFrom.colleges.flatMap((c) => (c.unitId ? infoCardsForCollege(c.unitId) : []));
  const groups: { id: AuditGroupId; title: string; lead?: string; extra?: InfoCard[] }[] = [
    { id: "graduation", title: "Graduation" },
    {
      id: "colleges",
      title: "Colleges",
      lead: path.builtFrom.colleges.some((c) => c.stateDefault)
        ? "No in-state public college on your list yet, so we use a labeled default. Add colleges to your list to see theirs."
        : undefined,
      extra: [...collegeCards, ...cards.admissions],
    },
    { id: "scholarships", title: "Scholarships and college credit", lead: "We never say you qualify; these show how classes can help.", extra: cards.aid },
  ];
  return (
    <PathSection id="path-counts" title="What counts toward what" lead="Tap any line to see who asks for it, how strongly, and the source's own words.">
      <div className="space-y-6">
        {groups.map((g) => {
          const sets = auditGroup(path, g.id);
          if (!sets.length && !g.extra?.length) return null;
          return (
            <Group key={g.id} id={g.id} title={g.title} lead={g.lead}>
              {sets.map((rs) => (
                <RuleSetCard key={rs.ruleSetId} rs={rs} path={path} name={name} />
              ))}
              {g.extra && <InfoCards cards={g.extra} />}
            </Group>
          );
        })}
        <Group id="prep" title="Major prep" lead="Classes that prepare you for the kind of major or program your goals point to.">
          <MajorPrep path={path} planId={planId} />
        </Group>
      </div>
    </PathSection>
  );
}

