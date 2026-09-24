import Link from "next/link";
import { AID_GUIDE_LANGUAGES, aidGuideHref } from "@/lib/aid-guide";
import { aidText } from "@/lib/aid-guide/dictionary";

// Shown for a guide address that doesn't exist (a mistyped section or language). Written in every
// language because the address doesn't tell us which one the reader wants.
export default function AidGuideNotFound() {
  return (
    <div className="mx-auto max-w-prose space-y-8 leading-7">
      {AID_GUIDE_LANGUAGES.map((lang, i) => {
        const Title = i === 0 ? "h1" : "h2";
        return (
          <div key={lang} lang={lang}>
            <Title className={`font-semibold tracking-tight ${i === 0 ? "text-2xl sm:text-3xl" : "text-xl"}`}>
              {aidText(lang, "notFoundTitle")}
            </Title>
            <p className="mt-2 text-muted">{aidText(lang, "notFoundBody")}</p>
            <Link
              href={aidGuideHref(lang)}
              hrefLang={lang}
              className="inline-flex min-h-11 items-center underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {aidText(lang, "notFoundLink")}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
