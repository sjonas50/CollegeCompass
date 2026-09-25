import { NOT_LISTED_NAME_MAX, type SchoolPick, type SchoolSettingsInput } from "./student";

// The school settings form's fields (src/components/school-settings.tsx) as saveSchoolSettings
// input. Shared by the student's and the parent's actions.

const field = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
};

/** A school radio's value: "" or "keep" (no change), "ref:<school_ref>", "not_listed", "prefer_not_to_say", "not_sure". */
function pickFrom(value: string, name: string): SchoolPick | { choice: "clear" } | undefined {
  if (value === "" || value === "keep") return undefined;
  if (value.startsWith("ref:")) return { choice: "listed", schoolRef: value.slice(4) };
  if (value === "not_listed") return { choice: "not_listed", name: name.slice(0, NOT_LISTED_NAME_MAX) };
  if (value === "prefer_not_to_say") return { choice: "prefer_not_to_say" };
  if (value === "not_sure") return { choice: "clear" };
  return undefined;
}

/** Form fields: `state`, `school` with `notListedName`, and `nextSchool` with `nextNotListedName`. */
export function schoolSettingsFromForm(formData: FormData): SchoolSettingsInput {
  const current = pickFrom(field(formData, "school"), field(formData, "notListedName"));
  return {
    state: field(formData, "state") || null,
    current: current?.choice === "clear" ? undefined : current,
    next: pickFrom(field(formData, "nextSchool"), field(formData, "nextNotListedName")),
  };
}
