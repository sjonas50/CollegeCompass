import type { CourseSubject, CourseTerm } from "@/db/schema";
import type { LetterGrade } from "@/lib/courses/catalog";
import { type PlannerState, type SchoolGrade, schoolYearLabel } from "../common";
import type { GenericCatalogFile } from "../content-types";
import { COURSE_TYPE_IDS, courseTypeTitle, type CourseTypeId, getCourseType, isCollegeLevel } from "../course-types";
import type { CatalogCourse, CatalogRef, CatalogView } from "../engine-io";
import { gradeRange } from "./util";

// ---------------------------------------------------------------------------
// Class lists (design §5.3, §5.11): the list each remaining grade plans from, the generic list
// built from the state's content, grade availability, and prerequisites with cycles and
// unresolved references ignored (and flagged).
// ---------------------------------------------------------------------------

export type PrereqGroup = {
  /** Any one of these course types meets it. */
  types: CourseTypeId[];
  /** Or any one of these rows of this list. */
  catalogIds: string[];
  minLetter: LetterGrade | null;
  concurrentOk: boolean;
};

export type CatalogRow = Omit<CatalogCourse, "typeId"> & {
  typeId: CourseTypeId;
  gradesAllowed: SchoolGrade[];
  prereqGroups: PrereqGroup[];
  collegeLevel: boolean;
  /** How a suggestion of this row is scheduled; "summer" rows are only offered in summer. */
  defaultTerm: CourseTerm;
  /** Vocabulary order of the type, for stable sorting. */
  order: number;
};

export type CatalogIssue = { kind: "prereq_cycle" | "prereq_unresolved"; rowId: string; title: string; typeId: CourseTypeId | null; otherTitle: string | null };

export type ResolvedCatalog = {
  view: CatalogView;
  ref: CatalogRef;
  /** A school's list (published or the family's check), as opposed to the generic list. */
  school: boolean;
  rows: CatalogRow[];
  byType: Map<CourseTypeId, CatalogRow[]>;
  byId: Map<string, CatalogRow>;
  issues: CatalogIssue[];
};

const TYPE_ORDER = new Map<CourseTypeId, number>(COURSE_TYPE_IDS.map((id, i) => [id, i]));

/** Vocabulary order (subjects together), for stable sorting. */
export function typeOrder(id: CourseTypeId): number {
  return TYPE_ORDER.get(id) ?? 0;
}

/**
 * Grades a row can be taken in. Printed grades win. Without them the type's usual window applies,
 * except that sequence classes (math from Algebra I up, world languages, CTE levels) follow their
 * prerequisites rather than a window, so a student who is ahead or behind can keep climbing, and
 * other high school classes may come later than usual. The fill still prefers the usual grades.
 */
export function defaultGrades(typeId: CourseTypeId): SchoolGrade[] {
  const type = getCourseType(typeId);
  const ladder = type.ladder;
  if (ladder && ((ladder.id === "math" && ladder.rank >= 1) || ladder.id.startsWith("lang.") || ladder.id.startsWith("cte."))) {
    return gradeRange(Math.min(type.grades[0], 9), 12);
  }
  // English I-IV follow the grade; other classes can come later than usual (a student catching up),
  // never earlier. A school's printed grades always win.
  if (ladder && ladder.id === "ela") return gradeRange(type.grades[0], type.grades[1]);
  return gradeRange(type.grades[0], Math.max(type.grades[1], type.grades[0] >= 9 ? 12 : type.grades[1]));
}

function termFor(course: Pick<CatalogCourse, "terms" | "units" | "delivery">): CourseTerm {
  if (course.delivery === "summer" || (course.terms.length > 0 && course.terms.every((t) => t === "summer"))) return "summer";
  if (course.terms.includes("full_year")) return "full_year";
  if (course.terms.includes("fall")) return "fall";
  if (course.terms.includes("spring")) return "spring";
  return course.units <= 2 ? "fall" : "full_year";
}

/** "Classes most Texas high schools offer", as a class list. */
export function genericCatalogView(file: GenericCatalogFile): CatalogView {
  const courses: CatalogCourse[] = file.courses.flatMap((c) =>
    c.levels.map((level) => {
      const type = getCourseType(c.typeId);
      const units = c.units ?? type.units;
      return {
        id: `generic:${c.typeId}:${level}`,
        typeId: c.typeId,
        level,
        subject: type.subject,
        title: courseTypeTitle(c.typeId, file.state),
        units,
        grades: c.grades ?? null,
        terms: units <= 2 ? ["fall", "spring"] : ["full_year"],
        prereqs: [],
        approvals: [],
        cte: type.cte === "always",
        lectureOnly: false,
        delivery: "unknown",
        firstSchoolYear: c.firstSchoolYear ?? null,
        everyOtherYear: false,
      } satisfies CatalogCourse;
    }),
  );
  return {
    id: `generic:${file.state}`,
    source: "generic",
    state: file.state,
    schoolYear: null,
    lastYears: false,
    classesPerYear: file.classesPerYear,
    schedule: "unknown",
    localTotalUnits: null,
    confirmedSubjects: "all",
    courses,
  };
}

export function catalogRef(view: CatalogView, genericTitle: string): CatalogRef {
  let label: string;
  if (view.source === "generic") label = genericTitle;
  else if (view.source === "school_family") label = view.schoolYear ? `${schoolYearLabel(view.schoolYear)} list, from your family's check` : "your family's check";
  else label = view.schoolYear ? `${schoolYearLabel(view.schoolYear)} list, checked by College Compass staff` : "checked by College Compass staff";
  if (view.lastYears) label += " (last year's list; classes can change)";
  return { source: view.source, schoolYear: view.schoolYear, lastYears: view.lastYears, label };
}

/** Tarjan's strongly connected components over row ids. */
function cyclicRows(ids: string[], edges: Map<string, string[]>): Set<string> {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const inCycle = new Set<string>();
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    on.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || (edges.get(v) ?? []).includes(v)) for (const c of comp) inCycle.add(c);
    }
  };
  for (const id of ids) if (!idx.has(id)) visit(id);
  return inCycle;
}

/**
 * The rows a grade plans from. Subjects a school list hasn't confirmed use the generic list's rows
 * for that subject when it has any (design §2.4: "until the core subjects are confirmed, the
 * planner uses the generic list for those subjects"). Unmapped rows (no type) never count.
 */
export function resolveCatalog(view: CatalogView, generic: CatalogView, genericTitle: string): ResolvedCatalog {
  let courses = view.courses;
  if (view.source !== "generic" && view.confirmedSubjects !== "all") {
    const confirmed = new Set<CourseSubject>(view.confirmedSubjects);
    const genericSubjects = new Set(generic.courses.map((c) => c.subject));
    courses = [
      ...view.courses.filter((c) => confirmed.has(c.subject) || !genericSubjects.has(c.subject)),
      ...generic.courses.filter((c) => !confirmed.has(c.subject)),
    ];
  }
  const mapped = courses.filter((c): c is CatalogCourse & { typeId: CourseTypeId } => c.typeId !== null);
  const ids = new Set(mapped.map((c) => c.id));
  const byTypeIds = new Map<CourseTypeId, string[]>();
  for (const c of mapped) byTypeIds.set(c.typeId, [...(byTypeIds.get(c.typeId) ?? []), c.id]);

  // Prerequisite edges printed on the list (row -> rows that meet it), for cycle detection.
  const issues: CatalogIssue[] = [];
  const edges = new Map<string, string[]>();
  for (const c of mapped) {
    const targets: string[] = [];
    for (const p of c.prereqs) {
      for (const ref of p.anyOf) {
        if ("catalogId" in ref) {
          if (ids.has(ref.catalogId)) targets.push(ref.catalogId);
        } else targets.push(...(byTypeIds.get(ref.typeId) ?? []));
      }
    }
    edges.set(c.id, targets);
  }
  const cyclic = cyclicRows([...ids], edges);
  const titleOf = new Map(mapped.map((c) => [c.id, c.title]));

  const rows: CatalogRow[] = mapped.map((c) => {
    let groups: PrereqGroup[];
    if (c.prereqs.length > 0) {
      groups = [];
      for (const p of c.prereqs) {
        const types: CourseTypeId[] = [];
        const catalogIds: string[] = [];
        for (const ref of p.anyOf) {
          if ("catalogId" in ref) {
            if (!ids.has(ref.catalogId)) {
              issues.push({ kind: "prereq_unresolved", rowId: c.id, title: c.title, typeId: c.typeId, otherTitle: null });
              continue;
            }
            if (cyclic.has(c.id) && cyclic.has(ref.catalogId)) {
              issues.push({ kind: "prereq_cycle", rowId: c.id, title: c.title, typeId: c.typeId, otherTitle: titleOf.get(ref.catalogId) ?? null });
              continue;
            }
            catalogIds.push(ref.catalogId);
          } else {
            const rowsOfType = byTypeIds.get(ref.typeId) ?? [];
            if (cyclic.has(c.id) && rowsOfType.some((r) => cyclic.has(r))) {
              issues.push({ kind: "prereq_cycle", rowId: c.id, title: c.title, typeId: c.typeId, otherTitle: titleOf.get(rowsOfType.find((r) => cyclic.has(r))!) ?? null });
              continue;
            }
            types.push(ref.typeId);
          }
        }
        // An edge that was ignored leaves its group empty: the whole prerequisite is ignored.
        if (types.length || catalogIds.length) groups.push({ types, catalogIds, minLetter: p.minLetter ?? null, concurrentOk: p.concurrentOk ?? false });
      }
    } else {
      const type = getCourseType(c.typeId);
      const typeGroups = [...type.prereqs, ...(isCollegeLevel(c.level) ? type.collegePrereqs : []), ...(c.level === "ap" || c.level === "ib" ? [] : type.sequencePrereqs)];
      groups = typeGroups.map((p) => ({ types: [...p.anyOf], catalogIds: [], minLetter: null, concurrentOk: false }));
    }
    return {
      ...c,
      gradesAllowed: c.grades ?? defaultGrades(c.typeId),
      prereqGroups: groups,
      collegeLevel: isCollegeLevel(c.level),
      defaultTerm: termFor(c),
      order: typeOrder(c.typeId),
    };
  });
  const byType = new Map<CourseTypeId, CatalogRow[]>();
  for (const r of rows) byType.set(r.typeId, [...(byType.get(r.typeId) ?? []), r]);
  return {
    view,
    ref: catalogRef(view, genericTitle),
    school: view.source !== "generic",
    rows,
    byType,
    byId: new Map(rows.map((r) => [r.id, r])),
    issues: dedupeIssues(issues),
  };
}

function dedupeIssues(issues: CatalogIssue[]): CatalogIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.kind}|${i.rowId}|${i.otherTitle}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function genericTitleFor(file: GenericCatalogFile, state: PlannerState): string {
  return file.title || `Classes most ${state} high schools offer`;
}
