/**
 * CIP codes (or code prefixes) of graduate and professional programs that students start after
 * college: doctors, dentists, vets, lawyers, pharmacists, optometrists, chiropractors, physician
 * assistants, physical and occupational therapists, audiologists and speech-language pathologists.
 * Career pages mark these "studied after college", and the major search never sends a student to
 * an undergraduate family because one of these is in it.
 */
const GRADUATE_PROGRAMS = [
  "01.80", "01.81", "22.01", "22.02", "51.01", "51.0202", "51.0203", "51.04", "51.05", "51.0912", "51.12", "51.14",
  "51.17", "51.2001", "51.2008", "51.2306", "51.2308",
];

export function isGraduateProgram(cipCode: string): boolean {
  return GRADUATE_PROGRAMS.some((prefix) => cipCode.startsWith(prefix));
}
