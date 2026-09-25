import type { CourseStatus, CourseTerm } from "@/db/schema";
import type { LetterGrade } from "@/lib/courses/catalog";
import { type PlannerState, type SchoolGrade } from "../../common";
import { type CohortOverrides, deriveCohort, schoolYearForGrade } from "../../cohort";
import { type CourseTypeId, type CourseTypeLevel, getCourseType } from "../../course-types";
import {
  type CatalogView,
  type CollegeTarget,
  type CourseFact,
  DEFAULT_LIMITS,
  type PlannerChoices,
  type PlannerContent,
  type PlannerInput,
  type PlannerLimits,
} from "../../engine-io";
import type { FamilyId } from "../../families";
import type { PathKind } from "../../rules";
import { tnContent, UTC, UTK, UTM } from "./content-tn";
import { TAMU, txContent, UT_AUSTIN } from "./content-tx";
import { USU, UOFU, utContent } from "./content-ut";
import { testFamilies } from "./families";

// Test helper: builds a PlannerInput from a short description, the way loadPlannerInput will
// from the database.

export type CourseSpec = {
  type: CourseTypeId;
  grade: SchoolGrade;
  level?: CourseTypeLevel;
  status?: CourseStatus;
  letter?: LetterGrade | null;
  name?: string;
  units?: number;
  term?: CourseTerm;
  assumed?: boolean;
  hsCredit?: boolean;
  lectureOnly?: boolean;
  catalogCourseId?: string | null;
  id?: string;
};

export type Scenario = {
  state: PlannerState | null;
  homeState?: string | null;
  grade: SchoolGrade;
  schoolYear?: number;
  month?: number;
  today?: string;
  courses?: CourseSpec[];
  families?: FamilyId[];
  colleges?: CollegeTarget[];
  path?: PathKind;
  choices?: PlannerChoices;
  limits?: Partial<PlannerLimits>;
  dismissed?: string[];
  catalogs?: Partial<Record<SchoolGrade, CatalogView>>;
  cohort?: CohortOverrides;
  content?: PlannerContent | null;
};

const CAREER_FOR: Partial<Record<FamilyId, { cip6: string; because: string }>> = {
  engineering: { cip6: "14.1901", because: "Mechanical Engineer" },
  computer_data_science: { cip6: "11.0701", because: "Software Developer" },
  nursing: { cip6: "51.3801", because: "Registered Nurse" },
  construction_trades: { cip6: "46.0302", because: "Electrician" },
  math_physical_sciences: { cip6: "40.0801", because: "Physicist" },
  business: { cip6: "52.0301", because: "Accountant" },
};

export const COLLEGES = {
  utAustin: { unitId: UT_AUSTIN, name: "The University of Texas at Austin", state: "TX", public: true, admissionRate: 0.266, openAdmission: false },
  tamu: { unitId: TAMU, name: "Texas A&M University", state: "TX", public: true, admissionRate: 0.574, openAdmission: false },
  utk: { unitId: UTK, name: "The University of Tennessee, Knoxville", state: "TN", public: true, admissionRate: 0.416, openAdmission: false },
  utc: { unitId: UTC, name: "The University of Tennessee at Chattanooga", state: "TN", public: true, admissionRate: 0.8, openAdmission: false },
  utm: { unitId: UTM, name: "The University of Tennessee at Martin", state: "TN", public: true, admissionRate: 0.7, openAdmission: false },
  usu: { unitId: USU, name: "Utah State University", state: "UT", public: true, admissionRate: 0.925, openAdmission: false },
  uofu: { unitId: UOFU, name: "University of Utah", state: "UT", public: true, admissionRate: 0.86, openAdmission: false },
  austinCc: { unitId: 222178, name: "Austin Community College", state: "TX", public: true, admissionRate: null, openAdmission: true },
} satisfies Record<string, CollegeTarget>;

export function contentFor(state: PlannerState): PlannerContent {
  const base = state === "TX" ? txContent() : state === "TN" ? tnContent() : utContent();
  return { ...base, families: testFamilies() };
}

export function scenario(s: Scenario): PlannerInput {
  const schoolYear = s.schoolYear ?? 2026;
  const month = s.month ?? 9;
  const cohort = deriveCohort(s.grade, schoolYear, s.cohort);
  const courses: CourseFact[] = (s.courses ?? []).map((c, i) => {
    const type = getCourseType(c.type);
    const status: CourseStatus = c.status ?? (c.grade < s.grade ? "completed" : c.grade === s.grade && month !== 6 && month !== 7 ? "in_progress" : c.grade === s.grade ? "completed" : "planned");
    const assumed = c.assumed ?? false;
    return {
      id: c.id ?? `c${i + 1}`,
      name: c.name ?? type.title,
      typeId: c.type,
      typeSource: assumed ? "guess" : "student",
      assumed,
      level: c.level ?? "regular",
      subject: type.subject,
      grade: c.grade,
      schoolYear: schoolYearForGrade(cohort, c.grade),
      term: c.term ?? (( c.units ?? type.units) <= 2 ? "fall" : "full_year"),
      units: c.units ?? type.units,
      status,
      finalGrade: status === "completed" ? (c.letter === undefined ? "A" : c.letter) : null,
      highSchoolCredit: c.hsCredit ?? c.grade >= 9,
      cte: type.cte === "always",
      lectureOnly: c.lectureOnly ?? false,
      catalogCourseId: c.catalogCourseId ?? null,
      origin: "typed",
    };
  });
  return {
    asOf: { today: s.today ?? `${month >= 8 ? schoolYear : schoolYear + 1}-${String(month).padStart(2, "0")}-15`, schoolYear, month },
    student: { grade: s.grade, cohort },
    state: s.state,
    homeState: s.homeState === undefined ? s.state : s.homeState,
    catalogs: s.catalogs ?? {},
    courses,
    targets: {
      path: s.path ?? "degree",
      families: (s.families ?? []).map((familyId) => ({
        familyId,
        source: "north_star" as const,
        cip6: CAREER_FOR[familyId]?.cip6 ?? null,
        because: CAREER_FOR[familyId]?.because ?? null,
      })),
      colleges: s.colleges ?? [],
    },
    prefs: { choices: s.choices ?? {}, limits: { ...DEFAULT_LIMITS, ...s.limits }, dismissed: s.dismissed ?? [] },
    content: s.content === undefined ? (s.state ? contentFor(s.state) : null) : s.content,
  };
}
