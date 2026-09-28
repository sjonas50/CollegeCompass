import type { CourseStatus, CourseTerm } from "@/db/schema";
import type { LetterGrade } from "@/lib/courses/catalog";
import type { SchoolGrade } from "../../common";
import { type CourseTypeId, type CourseTypeLevel, getCourseType } from "../../course-types";
import type { Req, Variant } from "../../rules";
import { type Alternative, compileVariant } from "../compile";
import { type Item, itemFromFact } from "../model";

// Test helpers for the allocation and oracle tests: items and single-variant compilation.

let n = 0;

export function item(
  typeId: CourseTypeId,
  opts: { grade?: SchoolGrade; units?: number; status?: CourseStatus; letter?: LetterGrade | null; level?: CourseTypeLevel; assumed?: boolean; hsCredit?: boolean; term?: CourseTerm; lectureOnly?: boolean; id?: string } = {},
): Item {
  const type = getCourseType(typeId);
  const status = opts.status ?? "completed";
  return itemFromFact({
    id: opts.id ?? `t${++n}`,
    name: type.title,
    typeId,
    typeSource: opts.assumed ? "guess" : "student",
    assumed: opts.assumed ?? false,
    level: opts.level ?? "regular",
    subject: type.subject,
    grade: opts.grade ?? 10,
    schoolYear: 2026,
    term: opts.term ?? "full_year",
    units: opts.units ?? type.units,
    status,
    finalGrade: status === "completed" ? (opts.letter === undefined ? "B" : opts.letter) : null,
    highSchoolCredit: opts.hsCredit ?? true,
    cte: type.cte === "always",
    lectureOnly: opts.lectureOnly ?? false,
    catalogCourseId: null,
    origin: "typed",
  });
}

export function variant(requirements: Req[], allocation: Variant["allocation"] = "exclusive", id = "test.v"): Variant {
  return { id, cohort: {}, allocation, requirements };
}

export function alternatives(v: Variant, bases: Variant[] = [], choices = {}): Alternative[] {
  return compileVariant(
    v,
    { strength: "required", strengthCite: "c" },
    bases.map((b) => ({ variant: b, rs: { strength: "required" as const, strengthCite: "c" } })),
    choices,
  );
}
