import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Notice, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import {
  CATEGORY_LABELS,
  MODEL_TIER_LABELS,
  OUTCOME_LABELS,
  SEVERITY_LABELS,
  formatAgo,
  formatDateTime,
  sourceLabel,
} from "@/lib/admin/format";
import { openSafetyEvent } from "@/lib/admin/safety-review";
import { requireUser } from "@/lib/auth/dal";
import { OverdueBadge, SeverityBadge, TimingText } from "../../ui";
import { ContextReveal } from "./context-reveal";
import { ParentContactReveal } from "./parent-contact-reveal";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Safety event" };

const EXCERPT_LIMIT = 1000;

export default async function SafetyEventPage({ params, searchParams }: PageProps<"/admin/safety/[id]">) {
  const admin = await requireUser(["admin"]);
  const { id } = await params;
  const { reviewed } = await searchParams;
  const now = new Date();
  // Opening an event shows the student's own words and staff notes, so it's audited in the lib.
  const event = await openSafetyEvent(await getDb(), admin.id, id, now);
  if (!event) notFound();
  const { timing } = event;

  return (
    <div className="space-y-6">
      <Link href="/admin/safety" className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">
        Back to the queue
      </Link>
      <PageHeading title={`${SEVERITY_LABELS[event.severity]}: ${CATEGORY_LABELS[event.category]}`} lead={`Flagged ${formatAgo(event.createdAt, now)}.`} />
      {reviewed && <Notice>Review saved.</Notice>}

      <p className="flex flex-wrap items-center gap-2 text-sm">
        <SeverityBadge severity={event.severity} />
        {timing.state === "waiting" && timing.overdue && <OverdueBadge />}
        <TimingText timing={timing} outcome={event.reviewOutcome} now={now} />
      </p>

      <Card>
        <h2 className="font-medium">What the student wrote</h2>
        <blockquote className="mt-2 border-l-4 border-border pl-3 break-words whitespace-pre-wrap">{event.excerpt}</blockquote>
        <p className="mt-3 text-xs text-muted">
          Keep this confidential.
          {event.excerpt.length >= EXCERPT_LIMIT && " Only the first 1,000 characters are kept here; the full message is in the conversation."}
        </p>
      </Card>

      <Card>
        <h2 className="font-medium">Details</h2>
        <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted">Flagged</dt>
          <dd>{formatDateTime(event.createdAt)}</dd>
          <dt className="text-muted">Severity</dt>
          <dd>{SEVERITY_LABELS[event.severity]}</dd>
          <dt className="text-muted">Category</dt>
          <dd>{CATEGORY_LABELS[event.category]}</dd>
          <dt className="text-muted">Flagged by</dt>
          <dd>{event.sources.map(sourceLabel).join(", ") || "No tier recorded"}</dd>
          <dt className="text-muted">AI model tier</dt>
          <dd>
            {MODEL_TIER_LABELS[event.modelTier]}
            {event.rulesAlone && " Keyword rules alone decided, so the rating may be off in either direction."}
          </dd>
          {event.sentWhileLocked && (
            <>
              <dt className="text-muted">Sent</dt>
              <dd>While the counselor was locked, so it wasn&apos;t saved in a conversation</dd>
            </>
          )}
          <dt className="text-muted">Student</dt>
          <dd>{event.gradeBand}</dd>
          <dt className="text-muted">Family reference</dt>
          <dd>
            <span className="font-mono">{event.familyRef}</span>
            <span className="text-muted"> · use this, never a name, in notes, tickets and chat</span>
          </dd>
          <dt className="text-muted">Review target</dt>
          <dd>{formatDateTime(timing.dueAt)}</dd>
        </dl>
      </Card>

      <Card>
        <h2 className="font-medium">Conversation context</h2>
        <div className="mt-2">
          <ContextReveal eventId={event.id} />
        </div>
      </Card>

      <Card>
        <h2 className="font-medium">Parent contact</h2>
        <div className="mt-2">
          <ParentContactReveal eventId={event.id} />
        </div>
      </Card>

      <Card>
        <h2 className="font-medium">Review</h2>
        <div className="mt-2">
          {event.reviewedAt ? (
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted">Outcome</dt>
              <dd className="font-medium">{event.reviewOutcome ? OUTCOME_LABELS[event.reviewOutcome] : "Reviewed"}</dd>
              <dt className="text-muted">Reviewed</dt>
              <dd>
                {formatDateTime(event.reviewedAt)} by {event.reviewerName ?? "a former staff member"}
              </dd>
              <dt className="text-muted">Note</dt>
              <dd className="break-words whitespace-pre-wrap">{event.reviewNote ?? "No note."}</dd>
            </dl>
          ) : (
            <ReviewForm eventId={event.id} familyRef={event.familyRef} />
          )}
        </div>
      </Card>
    </div>
  );
}
