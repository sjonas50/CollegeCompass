import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/ui";
import {
  AID_GUIDE_LANGUAGES,
  PRINTABLE_SECTIONS,
  aidGuideHref,
  getNeighbors,
  getSection,
  isAidLanguage,
  listSections,
  loadGuide,
} from "@/lib/aid-guide";
import { aidText } from "@/lib/aid-guide/dictionary";
import { headingAnchors } from "@/lib/aid-guide/navigation";
import { GuideBlock, GuideTopBar, LastUpdated, OnThisPage, ReviewStatus, SectionNav, SourcesList } from "../../guide-ui";
import { PrintButton } from "../../print-button";

// Only sections in the content files exist; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams({ params }: { params: { lang: string } }) {
  return isAidLanguage(params.lang) ? listSections(params.lang).map((s) => ({ section: s.id })) : [];
}

async function resolve(params: PageProps<"/aid/[lang]/[section]">["params"]) {
  const { lang, section: sectionId } = await params;
  if (!isAidLanguage(lang)) return null;
  const section = getSection(lang, sectionId);
  return section ? { lang, section } : null;
}

export async function generateMetadata({ params }: PageProps<"/aid/[lang]/[section]">): Promise<Metadata> {
  const found = await resolve(params);
  if (!found) return {};
  const { section } = found;
  return {
    title: section.title,
    description: section.summary,
    alternates: { languages: Object.fromEntries(AID_GUIDE_LANGUAGES.map((l) => [l, aidGuideHref(l, section.id)])) },
  };
}

/** One section of the guide: its blocks, where the information comes from, and the way on. */
export default async function AidGuideSectionPage({ params }: PageProps<"/aid/[lang]/[section]">) {
  const found = await resolve(params);
  if (!found) notFound();
  const { lang, section } = found;
  const guide = loadGuide(lang);
  const sections = listSections(lang);
  const position = sections.findIndex((s) => s.id === section.id);
  const neighbors = getNeighbors(lang, section.id);
  const anchors = headingAnchors(section.blocks);
  const contents = section.blocks.flatMap((block, i) => (block.heading && anchors[i] ? [{ id: anchors[i], label: block.heading }] : []));

  return (
    <>
      <GuideTopBar lang={lang} sectionId={section.id} />
      <p className="text-sm text-muted">{aidText(lang, "partOf", { n: position + 1, total: sections.length })}</p>
      <PageHeading title={section.title} lead={section.summary} />
      <div className="space-y-4">
        <ReviewStatus review={guide.review} lang={lang} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LastUpdated date={guide.updated} lang={lang} />
          {PRINTABLE_SECTIONS.has(section.id) && <PrintButton label={aidText(lang, "print")} />}
        </div>
        {contents.length > 0 && (
          <OnThisPage items={[...contents, { id: "sources", label: aidText(lang, "sourcesHeading") }]} lang={lang} />
        )}
      </div>

      <div className="mt-8 space-y-6">
        {section.blocks.map((block, i) => (
          <GuideBlock key={i} block={block} lang={lang} anchor={anchors[i]} />
        ))}
      </div>

      <div className="mt-10 space-y-10">
        <SourcesList sources={section.sources} lang={lang} />
        <SectionNav prev={neighbors?.prev ?? null} next={neighbors?.next ?? null} lang={lang} />
      </div>
    </>
  );
}
