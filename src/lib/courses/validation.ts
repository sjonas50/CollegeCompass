import * as z from "zod";
import { MAX_GRADE, MIN_GRADE } from "../auth/age";
import {
  COURSE_LEVELS,
  COURSE_STATUSES,
  COURSE_SUBJECTS,
  COURSE_TERMS,
  CREDIT_STEP,
  LETTER_GRADES,
  MAX_CREDITS,
  MIN_CREDITS,
  defaultHighSchoolCredit,
} from "./catalog";

const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);

/**
 * A course as a student enters it. `highSchoolCredit` defaults from the grade (on for 9–12, off
 * for 7–8) when not given; forms always send it explicitly from the checkbox.
 */
export const CourseInputSchema = z
  .object({
    name: z
      .string({ error: "Give the course a name." })
      .transform((s) => s.replace(/\s+/g, " ").trim())
      .pipe(z.string().min(1, "Give the course a name.").max(80, "Use 80 characters or fewer.")),
    subject: z.enum(COURSE_SUBJECTS, { error: "Choose a subject." }),
    level: z.enum(COURSE_LEVELS, { error: "Choose a level." }).default("regular"),
    gradeLevel: z.coerce
      .number({ error: `Choose a grade from ${MIN_GRADE} to ${MAX_GRADE}.` })
      .int(`Choose a grade from ${MIN_GRADE} to ${MAX_GRADE}.`)
      .min(MIN_GRADE, `Choose a grade from ${MIN_GRADE} to ${MAX_GRADE}.`)
      .max(MAX_GRADE, `Choose a grade from ${MIN_GRADE} to ${MAX_GRADE}.`),
    term: z.enum(COURSE_TERMS, { error: "Choose when you take it." }).default("full_year"),
    credits: z.coerce
      .number({ error: "Choose how many credits it's worth." })
      .min(MIN_CREDITS, `Credits go from ${MIN_CREDITS} to ${MAX_CREDITS}.`)
      .max(MAX_CREDITS, `Credits go from ${MIN_CREDITS} to ${MAX_CREDITS}.`)
      .multipleOf(CREDIT_STEP, "Credits go up in steps of 0.25.")
      .default(1),
    status: z.enum(COURSE_STATUSES, { error: "Choose planned, taking now or finished." }).default("planned"),
    finalGrade: z.preprocess(emptyToNull, z.enum(LETTER_GRADES, { error: "Choose a grade from the list." }).nullable()),
    highSchoolCredit: z.boolean().optional(),
  })
  .refine((c) => c.finalGrade === null || c.status === "completed", {
    error: "Only finished courses get a final grade.",
    path: ["finalGrade"],
  })
  .transform((c) => ({ ...c, highSchoolCredit: c.highSchoolCredit ?? defaultHighSchoolCredit(c.gradeLevel) }));

export type CourseInput = z.output<typeof CourseInputSchema>;
export type CourseInputRaw = z.input<typeof CourseInputSchema>;

/** Maps the planner's form fields to CourseInputSchema input. The credit checkbox is sent as "on". */
export function courseFormInput(formData: FormData): Record<string, unknown> {
  const text = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v : undefined;
  };
  return {
    name: text("name") ?? "",
    subject: text("subject"),
    level: text("level"),
    gradeLevel: text("gradeLevel"),
    term: text("term"),
    credits: text("credits"),
    status: text("status"),
    finalGrade: text("finalGrade"),
    highSchoolCredit: formData.get("highSchoolCredit") === "on",
  };
}

/** What planner form actions return. `ok` means saved; the form then clears or closes. */
export type CourseFormState =
  | { ok?: boolean; message?: string; errors?: Record<string, string[] | undefined> }
  | undefined;
