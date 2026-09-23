import type { Metadata } from "next";
import { Card, PageHeading } from "@/components/ui";

export const metadata: Metadata = { title: "Data sources" };

export default function DataSourcesPage() {
  return (
    <>
      <PageHeading title="Where our information comes from" lead="College Compass uses free, public data and research-backed questionnaires." />
      <Card className="space-y-4 text-sm leading-relaxed">
        <p>
          <strong>Interest assessment.</strong> The 60 activities come from the{" "}
          <a className="underline" href="https://www.onetcenter.org/IP.html">O*NET Interest Profiler Short Form</a>, part of the{" "}
          <a className="underline" href="https://www.onetcenter.org/tools.html">O*NET Career Exploration Tools</a> by the U.S.
          Department of Labor, Employment and Training Administration (USDOL/ETA), used under the{" "}
          <a className="underline" href="https://creativecommons.org/licenses/by-nd/4.0/">CC BY-ND 4.0</a> license. O*NET® is a
          trademark of USDOL/ETA.
        </p>
        <p>
          <strong>Personality assessment.</strong> The 20 statements are the Mini-IPIP (Donnellan, Oswald, Baird &amp; Lucas,
          2006), from the public-domain <a className="underline" href="https://ipip.ori.org/">International Personality Item Pool</a>.
        </p>
        <p>
          <strong>Careers.</strong> Career descriptions, interest profiles and preparation levels come from the{" "}
          <a className="underline" href="https://www.onetcenter.org/database.html">O*NET 31.0 Database</a>; work values come
          from the O*NET 30.0 Database. Both by USDOL/ETA, used under the{" "}
          <a className="underline" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> license. College
          Compass has combined and summarized this information; USDOL/ETA has not approved, endorsed, or tested these uses.
        </p>
        <p>
          <strong>Majors.</strong> The link between careers and college majors comes from the{" "}
          <a className="underline" href="https://nces.ed.gov/ipeds/cipcode/resources.aspx?y=56">CIP 2020–SOC 2018 crosswalk</a> by
          the National Center for Education Statistics.
        </p>
        <p>
          <strong>Colleges.</strong> College costs and outcomes come from the U.S. Department of Education&apos;s{" "}
          <a className="underline" href="https://collegescorecard.ed.gov/data/">College Scorecard</a>.
        </p>
      </Card>
    </>
  );
}
