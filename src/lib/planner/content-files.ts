// Every planner content file, relative to src/content/planner/. The loader (content.ts) imports
// exactly these, and `npm run check:rules` reads them from disk, so adding a file means adding
// it here and to content.ts (a test checks the two lists and the folder agree).

export const PLANNER_CONTENT_DIR = "src/content/planner";

export type ContentGroup = "rules" | "genericCatalogs" | "facts" | "families" | "cipRouting" | "rigor";

export const PLANNER_CONTENT_FILES: readonly { label: string; group: ContentGroup }[] = [
  { label: "ut/graduation.json", group: "rules" },
  { label: "ut/admissions.json", group: "rules" },
  { label: "ut/aid.json", group: "rules" },
  { label: "tn/graduation.json", group: "rules" },
  { label: "tn/options.json", group: "rules" },
  { label: "tn/admissions.json", group: "rules" },
  { label: "tn/aid.json", group: "rules" },
  { label: "tx/graduation.json", group: "rules" },
  { label: "tx/options.json", group: "rules" },
  { label: "tx/admissions.json", group: "rules" },
  { label: "tx/aid.json", group: "rules" },
  { label: "ut/generic-catalog.json", group: "genericCatalogs" },
  { label: "tn/generic-catalog.json", group: "genericCatalogs" },
  { label: "tx/generic-catalog.json", group: "genericCatalogs" },
  { label: "ut/facts.json", group: "facts" },
  { label: "tn/facts.json", group: "facts" },
  { label: "tx/facts.json", group: "facts" },
  { label: "major-prep/families.json", group: "families" },
  { label: "major-prep/cip-routing.json", group: "cipRouting" },
  { label: "major-prep/rigor.json", group: "rigor" },
];

/** Where the saved source copies live (outside git), one folder per content folder: .data/course-rules-verified/{ut,tn,tx,major-prep}/<SOURCE-KEY>.txt */
export const VERIFIED_SOURCES_DIR = ".data/course-rules-verified";
