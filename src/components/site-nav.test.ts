import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

const { StudentNav } = await import("./site-nav");

function renderNav(grade: number | null, pathname: string) {
  route.pathname = pathname;
  const html = renderToStaticMarkup(createElement(StudentNav, { grade }));
  const links = [...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map(([, attrs, label]) => ({ attrs, label }));
  return { html, links, labels: links.map((l) => l.label) };
}

describe("student nav", () => {
  it("shows every link on a phone by wrapping onto more rows, not scrolling sideways", () => {
    const { html, links } = renderNav(11, "/dashboard");
    expect(html).not.toContain("overflow-x");
    expect(html).toMatch(/<ul class="[^"]*\bflex-wrap\b/);
    for (const l of links) expect(l.attrs).toMatch(/class="[^"]*min-h-11/);
  });

  it("puts applying and paying for college before Careers in 11th and 12th grade", () => {
    const launch = ["Home", "Roadmap", "Plan", "Counselor", "Colleges", "My list", "Paying for it", "Careers"];
    expect(renderNav(11, "/dashboard").labels).toEqual(launch);
    expect(renderNav(12, "/dashboard").labels).toEqual(launch);
  });

  it("keeps careers first for younger students, without the launch links", () => {
    const younger = ["Home", "Roadmap", "Plan", "Counselor", "Careers", "Colleges"];
    expect(renderNav(7, "/dashboard").labels).toEqual(younger);
    expect(renderNav(10, "/dashboard").labels).toEqual(younger);
    expect(renderNav(null, "/dashboard").labels).toEqual(younger);
  });

  it("marks the current section", () => {
    const current = (grade: number, pathname: string) => renderNav(grade, pathname).links.filter((l) => l.attrs.includes('aria-current="page"')).map((l) => l.label);
    expect(current(12, "/aid/es/how-aid-works")).toEqual(["Paying for it"]);
    expect(current(11, "/applications/compare")).toEqual(["My list"]);
    expect(current(8, "/discover/interests")).toEqual(["Home"]);
    expect(current(8, "/colleges/166683")).toEqual(["Colleges"]);
  });
});
