import Link from "next/link";

/** Required notice for O*NET Career Exploration Tools content (CC BY-ND 4.0). */
export function OnetToolsAttribution() {
  return (
    <p className="text-xs text-muted">
      This page includes information from the{" "}
      <a href="https://www.onetcenter.org/tools.html" className="underline">O*NET Career Exploration Tools</a> by the U.S.
      Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the{" "}
      <a href="https://creativecommons.org/licenses/by-nd/4.0/" className="underline">CC BY-ND 4.0</a> license. O*NET® is a
      trademark of USDOL/ETA. <Link href="/about/data" className="underline">Data sources</Link>
    </p>
  );
}

/** Notice for O*NET Database content (CC BY 4.0). */
export function OnetDataAttribution() {
  return (
    <p className="text-xs text-muted">
      Career information from the <a href="https://www.onetcenter.org/database.html" className="underline">O*NET Database</a>{" "}
      by USDOL/ETA, used under the <a href="https://creativecommons.org/licenses/by/4.0/" className="underline">CC BY 4.0</a>{" "}
      license. <Link href="/about/data" className="underline">Data sources</Link>
    </p>
  );
}
