import { notFound } from "next/navigation";
import { AID_GUIDE_LANGUAGES, isAidLanguage } from "@/lib/aid-guide";
import { GuideRoot } from "../guide-ui";
import { DocumentLang } from "./document-lang";
import "../print.css";

// Only the guide's languages exist; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return AID_GUIDE_LANGUAGES.map((lang) => ({ lang }));
}

export default async function AidGuideLayout({ children, params }: LayoutProps<"/aid/[lang]">) {
  const { lang } = await params;
  if (!isAidLanguage(lang)) notFound();
  return (
    <GuideRoot lang={lang}>
      <DocumentLang lang={lang} />
      {children}
    </GuideRoot>
  );
}
