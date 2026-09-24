import Link from "next/link";
import type { ReactNode } from "react";
import {
  type AidGuide,
  type AidGuideBlock,
  type AidGuideSectionLink,
  type AidGuideSource,
  type AidLanguage,
  aidGuideHref,
} from "@/lib/aid-guide";
import { LANGUAGE_NAMES, aidText, formatGuideDate, otherLanguages } from "@/lib/aid-guide/dictionary";
import { linkify } from "@/lib/aid-guide/linkify";
import { ExternalIcon, GlobeIcon, InfoIcon, TipIcon, WarningIcon } from "./icons";

// Building blocks for the financial aid guide pages. Content is always rendered as React text
// nodes (never as HTML); bare web addresses become links through `linkify`.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const textLink = `underline underline-offset-2 hover:no-underline ${focusRing}`;

/** Wraps a page of the guide: its language (for screen readers and hyphenation) and reading width. */
export function GuideRoot({ lang, children }: { lang: AidLanguage; children: ReactNode }) {
  return (
    <div lang={lang} data-aid-guide="" className="mx-auto max-w-prose text-base leading-7 sm:text-lg sm:leading-8">
      {children}
    </div>
  );
}

/** A link to another website, opened in a new tab without giving that site a handle on this one. */
function ExternalLink({ href, lang, children }: { href: string; lang: AidLanguage; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`break-words ${textLink}`}>
      {children}
      <span className="sr-only"> {aidText(lang, "opensInNewTab")}</span>
    </a>
  );
}

/** Guide text with its bare https addresses turned into links. Everything else stays plain text. */
export function LinkedText({ text, lang }: { text: string; lang: AidLanguage }) {
  return (
    <>
      {linkify(text).map((segment, i) =>
        segment.type === "link" ? (
          <ExternalLink key={i} href={segment.href} lang={lang}>
            {segment.text}
          </ExternalLink>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

/** The language switch: the same page in the guide's other language(s). */
export function LanguageSwitch({ lang, sectionId }: { lang: AidLanguage; sectionId?: string }) {
  return (
    <nav aria-label={aidText(lang, "language")}>
      <ul className="flex flex-wrap gap-2">
        {otherLanguages(lang).map((other) => (
          <li key={other}>
            <Link
              href={aidGuideHref(other, sectionId)}
              hrefLang={other}
              lang={other}
              rel="alternate"
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-base font-medium hover:bg-background ${focusRing}`}
            >
              <GlobeIcon className="size-5" />
              {LANGUAGE_NAMES[other]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Top of every guide page: a way back (on section pages) and the language switch. */
export function GuideTopBar({ lang, sectionId }: { lang: AidLanguage; sectionId?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-2 print:hidden">
      {sectionId ? (
        <Link href={aidGuideHref(lang)} className={`inline-flex min-h-11 items-center text-base ${textLink}`}>
          <span aria-hidden="true">←&nbsp;</span>
          {aidText(lang, "allSections")}
        </Link>
      ) : (
        <span />
      )}
      <LanguageSwitch lang={lang} sectionId={sectionId} />
    </div>
  );
}

/** The review notice: a banner while the guide is a draft, a short credit once a counselor has reviewed it. */
export function ReviewStatus({ review, lang }: { review: AidGuide["review"]; lang: AidLanguage }) {
  if (review.status === "draft") {
    return (
      <div role="note" className="flex gap-3 rounded-lg border border-border bg-accent-soft p-4 text-base leading-7">
        <InfoIcon className="mt-1 size-5 shrink-0" />
        <p>{aidText(lang, "draftBanner")}</p>
      </div>
    );
  }
  if (!review.reviewedBy || !review.reviewedOn) return null;
  return (
    <p className="text-sm text-muted">
      {aidText(lang, "reviewedBy", { name: review.reviewedBy, date: formatGuideDate(review.reviewedOn, lang) })}
    </p>
  );
}

export function LastUpdated({ date, lang }: { date: string; lang: AidLanguage }) {
  return (
    <p className="text-sm text-muted">
      {aidText(lang, "lastUpdated")}: <time dateTime={date}>{formatGuideDate(date, lang)}</time>
    </p>
  );
}

/** The guide's sections as a list of cards; each whole card is the link. */
export function SectionList({ sections, lang }: { sections: AidGuideSectionLink[]; lang: AidLanguage }) {
  return (
    <ol className="space-y-3">
      {sections.map((section, i) => (
        <li key={section.id} className="relative rounded-xl border border-border bg-surface p-4 hover:bg-background">
          <p className="text-sm text-muted">{aidText(lang, "partOf", { n: i + 1, total: sections.length })}</p>
          <Link
            href={section.href}
            className="text-lg font-semibold leading-7 underline-offset-2 after:absolute after:inset-0 after:rounded-xl hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
          >
            {section.title}
          </Link>
          <p className="mt-1 text-base leading-7 text-muted">{section.summary}</p>
        </li>
      ))}
    </ol>
  );
}

/** "On this page": jump links to the section's headings and its sources. */
export function OnThisPage({ items, lang }: { items: { id: string; label: string }[]; lang: AidLanguage }) {
  return (
    <nav aria-labelledby="on-this-page" className="rounded-xl border border-border bg-surface p-4 print:hidden">
      <h2 id="on-this-page" className="text-base font-semibold">
        {aidText(lang, "onThisPage")}
      </h2>
      <ul className="mt-1">
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className={`flex min-h-11 items-center text-base ${textLink}`}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const CALLOUTS = {
  tip: { Icon: TipIcon, box: "border-accent bg-accent-soft", icon: "text-accent" },
  warning: { Icon: WarningIcon, box: "border-danger bg-danger-soft", icon: "text-danger" },
} as const;

function BlockHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-4 text-xl font-semibold leading-8 tracking-tight">
      {children}
    </h2>
  );
}

/** One block of a guide section. `anchor` is the id for its heading, if it has one. */
export function GuideBlock({ block, lang, anchor }: { block: AidGuideBlock; lang: AidLanguage; anchor?: string }) {
  const heading = block.heading ? <BlockHeading id={anchor}>{block.heading}</BlockHeading> : null;
  switch (block.kind) {
    case "paragraph":
      return (
        <div className="space-y-2">
          {heading}
          <p>
            <LinkedText text={block.text} lang={lang} />
          </p>
        </div>
      );
    case "list":
    case "steps": {
      const List = block.kind === "steps" ? "ol" : "ul";
      return (
        <div className="space-y-2">
          {heading}
          <List className={`space-y-2 pl-6 ${block.kind === "steps" ? "list-decimal marker:font-semibold" : "list-disc"}`}>
            {block.items.map((item, i) => (
              <li key={i} className="pl-1 break-inside-avoid">
                <LinkedText text={item} lang={lang} />
              </li>
            ))}
          </List>
        </div>
      );
    }
    case "tip":
    case "warning": {
      const { Icon: CalloutIcon, box, icon } = CALLOUTS[block.kind];
      return (
        <div role="note" className={`break-inside-avoid rounded-lg border-l-4 p-4 ${box}`}>
          <p className="flex items-center gap-2 font-semibold">
            <CalloutIcon className={`size-5 shrink-0 ${icon}`} />
            {aidText(lang, block.kind)}
          </p>
          {heading && <div className="mt-1">{heading}</div>}
          <p className="mt-1">
            <LinkedText text={block.text} lang={lang} />
          </p>
        </div>
      );
    }
  }
}

/** "Where this information comes from": each source links out; printed copies show the address. */
export function SourcesList({ sources, lang }: { sources: AidGuideSource[]; lang: AidLanguage }) {
  return (
    <section aria-labelledby="sources" className="border-t border-border pt-6">
      <h2 id="sources" className="scroll-mt-4 text-xl font-semibold leading-8 tracking-tight">
        {aidText(lang, "sourcesHeading")}
      </h2>
      <ul className="mt-2 space-y-2">
        {sources.map((source) => (
          <li key={source.url} className="flex gap-2">
            <ExternalIcon className="mt-1.5 size-4 shrink-0 text-muted print:hidden" />
            <span>
              <ExternalLink href={source.url} lang={lang}>
                {source.title}
              </ExternalLink>
              <span className="hidden break-all print:inline"> ({source.url})</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Previous and next sections, and the way back to the list. */
export function SectionNav({
  prev,
  next,
  lang,
}: {
  prev: AidGuideSectionLink | null;
  next: AidGuideSectionLink | null;
  lang: AidLanguage;
}) {
  const card = `flex min-h-11 flex-col justify-center rounded-xl border border-border bg-surface p-4 hover:bg-background ${focusRing}`;
  return (
    <nav aria-label={aidText(lang, "sectionNav")} className="space-y-3 print:hidden">
      <ul className="grid gap-3 sm:grid-cols-2">
        {prev && (
          <li>
            <Link href={prev.href} rel="prev" className={card}>
              <span className="text-sm text-muted">
                <span aria-hidden="true">←&nbsp;</span>
                {aidText(lang, "previous")}
                <span className="sr-only">:</span>
              </span>
              <span className="font-semibold">{prev.title}</span>
            </Link>
          </li>
        )}
        {next && (
          <li className="sm:col-start-2">
            <Link href={next.href} rel="next" className={`${card} sm:text-right`}>
              <span className="text-sm text-muted">
                {aidText(lang, "next")}
                <span className="sr-only">:</span>
                <span aria-hidden="true">&nbsp;→</span>
              </span>
              <span className="font-semibold">{next.title}</span>
            </Link>
          </li>
        )}
      </ul>
      <p>
        <Link href={aidGuideHref(lang)} className={`inline-flex min-h-11 items-center text-base ${textLink}`}>
          {aidText(lang, "allSections")}
        </Link>
      </p>
    </nav>
  );
}
