import type { AidGuideBlock, AidLanguage } from "./schema";

/** "/aid/es" for the guide's index, "/aid/es/how-aid-works" for a section. */
export function aidGuideHref(lang: AidLanguage, sectionId?: string): string {
  return sectionId ? `/aid/${lang}/${sectionId}` : `/aid/${lang}`;
}

/** The items before and after `id`, or null when `id` isn't in the list. */
export function neighborsIn<T extends { id: string }>(items: readonly T[], id: string): { prev: T | null; next: T | null } | null {
  const i = items.findIndex((item) => item.id === id);
  if (i === -1) return null;
  return { prev: items[i - 1] ?? null, next: items[i + 1] ?? null };
}

/** "¿Qué es la FAFSA?" → "que-es-la-fafsa". Accents are dropped so anchors stay plain ASCII. */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "part";
}

/** Element ids the section page uses for itself, which headings must not take. */
export const RESERVED_ANCHORS = ["sources", "main", "on-this-page"] as const;

/**
 * An anchor id for each block with a heading (undefined for blocks without one), unique within the
 * page: a repeated heading gets "-2", "-3", ….
 */
export function headingAnchors(blocks: readonly Pick<AidGuideBlock, "heading">[]): (string | undefined)[] {
  const used = new Set<string>(RESERVED_ANCHORS);
  return blocks.map((block) => {
    if (!block.heading) return undefined;
    const base = slugify(block.heading);
    let anchor = base;
    for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`;
    used.add(anchor);
    return anchor;
  });
}
