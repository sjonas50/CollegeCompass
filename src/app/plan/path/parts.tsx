import type { ReactNode } from "react";
import type { AuditStatus } from "@/lib/planner/engine-io";
import { STATUS_ICONS } from "@/lib/planner/view";

// Small shared pieces of "Your path". Statuses are words with an icon, never color alone and
// never red: "Room to add", not "behind".

const STATUS_STYLE: Record<AuditStatus, string> = {
  done: "bg-success-soft",
  planned: "bg-accent-soft",
  room_to_add: "border border-border",
  waiting_confirm: "border border-dashed border-accent",
  ask_counselor: "border border-dashed border-border",
  not_tracked: "border border-border text-muted",
};

export function StatusBadge({ status, word }: { status: AuditStatus; word: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${STATUS_STYLE[status]}`}>
      <span aria-hidden>{STATUS_ICONS[status]}</span>
      {word}
    </span>
  );
}

export function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "soft" | "note" }) {
  const style = tone === "soft" ? "bg-accent-soft" : tone === "note" ? "border border-dashed border-border" : "border border-border";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${style}`}>{children}</span>;
}

/** A section of the path with a heading and an optional lead line. */
export function PathSection({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div>
        <h3 id={id} tabIndex={-1} className="text-lg font-medium focus:outline-none">
          {title}
        </h3>
        {lead && <p className="text-sm text-muted">{lead}</p>}
      </div>
      {children}
    </section>
  );
}
