import { describe, expect, it } from "vitest";
import {
  CustomEntrySchema,
  UnitIdSchema,
  customEntryFormInput,
  entryFormInput,
  entryPatchSchema,
  formErrors,
  issueErrors,
} from "./validation";

const TODAY = "2026-09-24";
const patch = (input: unknown, keep?: string | null) => entryPatchSchema(TODAY, keep).safeParse(input);
const errorsOf = (input: unknown, keep?: string | null) => {
  const res = patch(input, keep);
  if (res.success) throw new Error("expected a validation error");
  return issueErrors(res.error);
};

describe("custom entries", () => {
  it("tidies spaces and accepts 1–100 characters", () => {
    expect(CustomEntrySchema.parse({ name: "  Electrician   apprenticeship ", kind: "program" })).toEqual({
      name: "Electrician apprenticeship",
      kind: "program",
    });
    expect(CustomEntrySchema.safeParse({ name: "x".repeat(100), kind: "college" }).success).toBe(true);
  });

  it("rejects blank, too-long names and unknown kinds", () => {
    expect(issueErrors(CustomEntrySchema.safeParse({ name: "   ", kind: "program" }).error!).name).toEqual(["Give it a name."]);
    expect(issueErrors(CustomEntrySchema.safeParse({ name: "x".repeat(101), kind: "program" }).error!).name?.[0]).toMatch(/100 characters/);
    expect(issueErrors(CustomEntrySchema.safeParse({ name: "Job Corps", kind: "job" }).error!).kind).toBeDefined();
    expect(CustomEntrySchema.safeParse({ kind: "program" }).success).toBe(false);
  });

  it("reads the form", () => {
    const fd = new FormData();
    fd.set("name", "Plumbing program");
    fd.set("kind", "program");
    expect(customEntryFormInput(fd)).toEqual({ name: "Plumbing program", kind: "program" });
    expect(customEntryFormInput(new FormData())).toEqual({ name: "", kind: undefined });
  });
});

describe("unit ids", () => {
  it("accepts positive whole numbers from numbers or strings", () => {
    expect(UnitIdSchema.parse("166027")).toBe(166027);
    expect(UnitIdSchema.parse(100654)).toBe(100654);
  });

  it("rejects everything else", () => {
    for (const bad of ["", "abc", "1.5", "-3", 0, Number.NaN, "99999999999"]) {
      expect(UnitIdSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});

describe("entry changes", () => {
  it("accepts every status and rejects unknown ones", () => {
    expect(patch({ status: "applied" }).data).toEqual({ status: "applied" });
    expect(errorsOf({ status: "maybe" }).status).toEqual(["Choose a status from the list."]);
  });

  it("clears the deadline type with blank or none", () => {
    expect(patch({ deadlineType: "" }).data).toEqual({ deadlineType: null });
    expect(patch({ deadlineType: "none" }).data).toEqual({ deadlineType: null });
    expect(patch({ deadlineType: null }).data).toEqual({ deadlineType: null });
    expect(patch({ deadlineType: "early_action" }).data).toEqual({ deadlineType: "early_action" });
    expect(errorsOf({ deadlineType: "late" }).deadlineType).toBeDefined();
  });

  it("only takes real dates", () => {
    expect(patch({ deadline: "" }).data).toEqual({ deadline: null });
    expect(patch({ deadline: " 2026-11-01 " }).data).toEqual({ deadline: "2026-11-01" });
    expect(errorsOf({ deadline: "2026-02-30" }).deadline).toEqual(["Enter a real date, like 2026-11-01."]);
    expect(errorsOf({ deadline: "11/01/2026" }).deadline).toEqual(["Enter a real date, like 2026-11-01."]);
    expect(errorsOf({ deadline: 20261101 }).deadline).toBeDefined();
  });

  it("keeps deadlines within two years of today", () => {
    expect(patch({ deadline: "2028-09-24" }).success).toBe(true);
    expect(patch({ deadline: "2024-09-24" }).success).toBe(true);
    expect(errorsOf({ deadline: "2028-09-25" }).deadline).toEqual(["Pick a date within two years of today."]);
    expect(errorsOf({ deadline: "2024-09-23" }).deadline).toEqual(["Pick a date within two years of today."]);
  });

  it("lets an already-saved deadline stay even when it's outside the window", () => {
    expect(patch({ deadline: "2024-01-15" }, "2024-01-15").success).toBe(true);
    expect(patch({ deadline: "2024-01-16" }, "2024-01-15").success).toBe(false);
  });

  it("trims notes, clears blank ones, and caps them at 1,000 characters", () => {
    expect(patch({ notes: "  Visit in spring  " }).data).toEqual({ notes: "Visit in spring" });
    expect(patch({ notes: "   " }).data).toEqual({ notes: null });
    expect(patch({ notes: "x".repeat(1000) }).success).toBe(true);
    expect(errorsOf({ notes: "x".repeat(1001) }).notes?.[0]).toMatch(/1,000 characters/);
  });

  it("counts a line break as one character, like the notes box does", () => {
    // Forms send each line break as two characters (\r\n); the textarea's limit counts one.
    const lines = Array.from({ length: 10 }, () => "x".repeat(99));
    expect(lines.join("\n")).toHaveLength(999);
    expect(patch({ notes: lines.join("\r\n") }).data).toEqual({ notes: lines.join("\n") });
    expect(patch({ notes: "One\rTwo\r\n\r\n" }).data).toEqual({ notes: "One\nTwo" });
    expect(errorsOf({ notes: `${lines.join("\r\n")}xx` }).notes?.[0]).toMatch(/1,000 characters/);
  });

  it("takes only known checklist items, as true or false", () => {
    expect(patch({ checklist: { applicationSubmitted: true, depositPaid: false } }).data).toEqual({
      checklist: { applicationSubmitted: true, depositPaid: false },
    });
    expect(errorsOf({ checklist: { applicationSubmitted: "yes" } })["checklist.applicationSubmitted"]).toBeDefined();
    expect(patch({ checklist: { essayWritten: true } }).success).toBe(false);
  });

  it("reads whole-dollar amounts and drops blanks", () => {
    expect(patch({ aidOffer: { costOfAttendance: "$31,250", grants: "12500", scholarships: "", workStudy: "2500.00" } }).data).toEqual({
      aidOffer: { costOfAttendance: 31250, grants: 12500, workStudy: 2500 },
    });
    expect(patch({ aidOffer: { grants: 0 } }).data).toEqual({ aidOffer: { grants: 0 } });
    expect(patch({ aidOffer: { grants: "200000" } }).success).toBe(true);
    expect(patch({ aidOffer: { grants: " $ 1,250 ", scholarships: "12500.0", workStudy: "100,000.00" } }).data).toEqual({
      aidOffer: { grants: 1250, scholarships: 12500, workStudy: 100000 },
    });
  });

  it("asks again when a period or comma could mean something else", () => {
    // "12.000" means twelve thousand in many countries, so it's never read as $12.
    for (const bad of ["12.000", "30.000", "1.250.000", "$12.500"]) {
      expect(errorsOf({ aidOffer: { grants: bad } })["aidOffer.grants"], bad).toEqual(["Use a comma for thousands, not a period, like 12,000."]);
    }
    for (const bad of ["1,2,3", "12,50", "1,00,000", ",500", "12,500,"]) {
      expect(errorsOf({ aidOffer: { grants: bad } })["aidOffer.grants"], bad).toEqual(["Check the commas. Write it like 12,500 or 12500."]);
    }
  });

  it("removes the offer when every amount is blank, or when it's null", () => {
    expect(patch({ aidOffer: { costOfAttendance: "", grants: " " } }).data).toEqual({ aidOffer: null });
    expect(patch({ aidOffer: null }).data).toEqual({ aidOffer: null });
  });

  it("rejects negative, fractional, too-large and non-number amounts, per field", () => {
    for (const bad of ["-5", "12.50", "12.5", "12.", "200001", "200,001", "lots", -1, 1.5]) {
      const errors = errorsOf({ aidOffer: { grants: bad } });
      expect(errors["aidOffer.grants"]?.[0], String(bad)).toMatch(/whole dollars from 0 to 200,000/);
    }
    expect(patch({ aidOffer: { bonus: "5" } }).success).toBe(false);
  });

  it("rejects fields it doesn't know", () => {
    expect(patch({ userId: "someone-else" }).success).toBe(false);
    expect(patch({ id: "x", status: "applied" }).success).toBe(false);
  });
});

describe("entry form", () => {
  it("sends only the sections the form had, with unchecked boxes as false", () => {
    const fd = new FormData();
    fd.set("status", "applying");
    fd.set("deadline", "2026-11-01");
    fd.set("has_checklist", "1");
    fd.set("check_transcriptRequested", "on");
    const input = entryFormInput(fd);
    expect(input.status).toBe("applying");
    expect(input.deadline).toBe("2026-11-01");
    expect(input).not.toHaveProperty("notes");
    expect(input).not.toHaveProperty("aidOffer");
    expect(input.checklist).toMatchObject({ transcriptRequested: true, applicationSubmitted: false, depositPaid: false });
    expect(Object.keys(input.checklist as object)).toHaveLength(8);
  });

  it("sends every aid amount when the aid section is there", () => {
    const fd = new FormData();
    fd.set("has_aid", "1");
    fd.set("aid_grants", "5,000");
    const input = entryFormInput(fd);
    expect(input.aidOffer).toMatchObject({ grants: "5,000", costOfAttendance: "" });
    expect(patch(input).data).toEqual({ aidOffer: { grants: 5000 } });
  });

  it("maps error keys to form field names", () => {
    expect(formErrors({ "aidOffer.grants": ["a"], "checklist.depositPaid": ["b"], deadline: ["c"] })).toEqual({
      aid_grants: ["a"],
      check_depositPaid: ["b"],
      deadline: ["c"],
    });
  });
});
