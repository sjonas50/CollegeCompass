import type { Metadata } from "next";
import { Card, PageHeading } from "@/components/ui";
import { SCORECARD_RELEASE } from "@/lib/colleges/describe";

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
          Four of its five traits give a small boost to careers that especially call for them, but only traits a student rates
          above the middle of the scale: at most 10 points out of 100. A trait at or below the middle never pushes a career
          down. Emotional stability (&ldquo;Staying calm&rdquo;) never changes which careers are suggested.
        </p>
        <p>
          <strong>Work styles.</strong> The strengths that help in each career, like attention to detail or empathy, come from
          the Work Styles data in the{" "}
          <a className="underline" href="https://www.onetcenter.org/dictionary/31.0/excel/work_styles.html">O*NET 31.0 Database</a>{" "}
          by USDOL/ETA, used under the{" "}
          <a className="underline" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> license. O*NET made these
          ratings with a hybrid AI and expert method (its source is marked &ldquo;AI/Expert&rdquo;) rather than by surveying
          workers, so we treat them as estimates: we show them as a starting point and use them only lightly in career matches.
          College Compass connects them to personality traits in its own way; USDOL/ETA has not approved, endorsed, or tested
          this use. In matches, each career is compared only with careers that need about the same amount of preparation, so
          personality doesn&apos;t favor careers that take more school.
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
          <strong>Colleges and programs.</strong> College costs, graduation rates and earnings come from the U.S.
          Department of Education&apos;s <a className="underline" href="https://collegescorecard.ed.gov/data/">College Scorecard</a>{" "}
          institution data. The programs each college offers, and what their graduates typically earn and owe, come from
          the College Scorecard field-of-study data. Both are from the {SCORECARD_RELEASE} release. Graduation rates
          combine two starting years and aren&apos;t shown when fewer than 30 students started. Net price is what a year
          costs, including housing, food and books, after grants and scholarships. It&apos;s an average for new
          full-time students who got financial aid (at public colleges, in-state students). When grants add up to more
          than the cost, we show $0. College Compass is not part of, or endorsed by, the U.S. Department of Education.
        </p>
        <p>
          Some colleges are missing a number. Sometimes the college didn&apos;t report it. Other times so few students
          are in a group that sharing it could reveal private information, so the government leaves it out. When that
          happens, we tell you instead of guessing. A missing number doesn&apos;t mean a college is bad. Learn more in
          the{" "}
          <a className="underline" href="https://collegescorecard.ed.gov/data/data-documentation/">College Scorecard data documentation</a>.
        </p>
      </Card>
    </>
  );
}
