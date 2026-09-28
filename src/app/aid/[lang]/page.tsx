import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { AID_GUIDE_LANGUAGES, aidGuideHref, isAidLanguage, listSections, loadGuide } from "@/lib/aid-guide";
import { type AidTextKey, aidText } from "@/lib/aid-guide/dictionary";
import { sectionsForStates } from "@/lib/aid-guide/states";
import { GuideTopBar, LastUpdated, ReviewStatus, SectionList, StateSections } from "../guide-ui";
import { guideStatesForViewer } from "../viewer-states";

export async function generateMetadata({ params }: PageProps<"/aid/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isAidLanguage(lang)) return {};
  return {
    title: aidText(lang, "guideTitle"),
    description: aidText(lang, "metaDescription"),
    alternates: { languages: Object.fromEntries(AID_GUIDE_LANGUAGES.map((l) => [l, aidGuideHref(l)])) },
  };
}

/** The guide's front page: who it's for, how current it is, and every section. */
export default async function AidGuideIndexPage({ params }: PageProps<"/aid/[lang]">) {
  const { lang } = await params;
  if (!isAidLanguage(lang)) notFound();
  const guide = loadGuide(lang);
  const t = (key: AidTextKey) => aidText(lang, key);
  // A signed-in student's own state: which parts of the guide have its programs (English only).
  const states = await guideStatesForViewer(lang);

  return (
    <>
      <GuideTopBar lang={lang} />
      <PageHeading title={t("guideTitle")} lead={t("introLead")} />
      <div className="space-y-4">
        <p>{t("introAudience")}</p>
        <p>{t("introPaths")}</p>
        <ReviewStatus review={guide.review} lang={lang} />
        <LastUpdated date={guide.updated} lang={lang} />
        <StateSections sections={sectionsForStates(guide, states)} states={states} />
      </div>
      <section aria-labelledby="guide-sections" className="mt-10">
        <h2 id="guide-sections" className="text-xl font-semibold leading-8 tracking-tight">
          {t("sectionsHeading")}
        </h2>
        <p className="mb-4 text-muted">{t("introStart")}</p>
        <SectionList sections={listSections(lang)} lang={lang} />
      </section>
    </>
  );
}
