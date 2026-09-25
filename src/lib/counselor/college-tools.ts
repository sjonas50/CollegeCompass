import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import * as z from "zod";
import type { Db } from "@/db";
import { AID_GUIDE_SECTION_IDS, loadGuide } from "../aid-guide";
import { aidGuideToolResult } from "../aid-guide/counselor";
import { isGraduateProgram } from "../colleges/graduate";
import {
  CONTROL_LABELS,
  CREDENTIAL_LABELS,
  type CollegeSearchFilters,
  MEANINGS,
  PUBLIC_IN_STATE_NOTE,
  TRANSFER_NOTE,
  collegeSearchHref,
  findStrongPrograms,
  getCollege,
  majorsForCip6,
  outOfStateCost,
  programTitle,
  resolveMajorQuery,
  searchColleges,
  stateFromCodeOrName,
} from "../colleges";

// Reference-data tools for college and aid questions. They read only public data (College
// Scorecard, our financial aid guide), never the student's, and take no ids from the model beyond
// a college's public UNITID.

const CREDENTIALS = { certificate: 1, associate: 2, bachelor: 3 } as const;
const CONTROLS = { public: 1, private_nonprofit: 2, for_profit: 3 } as const;
const RESULTS = 8;
/** Program titles listed per credential level when get_college has no major to look for. */
const TITLES_PER_LEVEL = 60;

/** Net prices can be negative when grants exceed the cost; students see $0 on our pages. */
const price = (n: number | null) => (n === null ? null : Math.max(0, n));
const pct = (n: number | null) => (n === null ? null : Math.round(n * 100));

/** A 4-digit CIP family ("51.38") or a 6-digit major ("51.3801", as in get_career) → its family. */
const cipFamily = (text: string) => majorsForCip6(text.trim());

const GRADUATE_NOTE =
  "This is studied after college, in graduate or professional school, so undergraduate programs don't train for it. Search a related undergraduate major instead (like a pre-professional, biology or health sciences major), and tell the student how the path usually goes.";

const COMPLETION_NOTE =
  "completionRatePercent counts students who transfer to another college before finishing as not completing, so community college rates look low.";

export function collegeTools(db: Db): BetaRunnableTool[] {
  const search = betaZodTool({
    name: "search_colleges",
    description:
      "Search U.S. colleges and training schools in the Department of Education's College Scorecard by name, major, state, city, type and size. A search by name lists the best name matches first. Returns net price (what students paid after grants), completion rate and earnings, plus a link to our College explorer page for each. Use it before naming specific schools. If the major words match several programs, it returns choices: search again with the chosen cip4.",
    inputSchema: z.object({
      major: z
        .string()
        .min(2)
        .max(80)
        .optional()
        .describe("A major, program or job in plain words ('nursing', 'welding', 'electrician', 'dental hygiene'), or a CIP code like '51.38' or '48.0508'"),
      state: z.string().min(2).max(30).optional().describe("Two-letter state code or state name"),
      name: z.string().min(2).max(80).optional().describe("Words in the school's name or its city, or its initials, e.g. 'Ohio State', 'MIT' or 'Austin'"),
      credential: z.enum(["certificate", "associate", "bachelor"]).optional(),
      type: z.enum(["public", "private_nonprofit", "for_profit"]).optional(),
      size: z.enum(["small", "medium", "large"]).optional().describe("small: under 5,000 undergrads; medium: 5,000-15,000; large: over 15,000"),
      sort: z
        .enum(["relevance", "net_price", "completion", "earnings", "name"])
        .optional()
        .describe("'relevance': best name matches first (the default when name is given). Otherwise the default is lowest net price"),
    }),
    run: async (input) => {
      const filters: CollegeSearchFilters = { sort: input.sort ?? (input.name ? "relevance" : "net_price") };
      if (input.name) filters.q = input.name;
      if (input.state) {
        const state = stateFromCodeOrName(input.state);
        if (!state) return JSON.stringify({ error: "Unknown state. Use a two-letter code like 'TX'." });
        filters.state = state;
      }
      if (input.credential) filters.credential = CREDENTIALS[input.credential];
      if (input.type) filters.control = CONTROLS[input.type];
      if (input.size) filters.size = input.size;
      let major: { cip4: string; title: string | null; includes?: string } | null = null;
      if (input.major) {
        if (isGraduateProgram(input.major.trim())) return JSON.stringify({ note: GRADUATE_NOTE });
        const cip4 = cipFamily(input.major);
        if (cip4) {
          major = { cip4, title: await programTitle(db, cip4) };
        } else {
          const resolved = await resolveMajorQuery(db, input.major);
          if (resolved.kind === "none") return JSON.stringify({ note: "No college programs match that major. Try another word for it." });
          if (resolved.kind === "choices") {
            return JSON.stringify({
              note: "Several program families match, the most relevant and widely offered first. Search again with one cip4, or ask the student which one they mean.",
              choices: resolved.choices,
              moreChoices: resolved.more,
            });
          }
          major = resolved.major;
        }
        filters.major = major.cip4;
      }
      const found = await searchColleges(db, filters);
      const results = found.results.slice(0, RESULTS);
      return JSON.stringify({
        total: found.total,
        major,
        moreResults: collegeSearchHref(filters),
        notes: [
          "Net prices are averages. For a personal estimate, tell the student to open the college's page (page), which links that college's own net price calculator.",
          COMPLETION_NOTE,
          ...(results.some((c) => c.control === 1) ? [`Public colleges: ${PUBLIC_IN_STATE_NOTE}`] : []),
        ],
        results: results.map((c) => ({
          unitId: c.unitId,
          name: c.name,
          place: [c.city, c.state].filter(Boolean).join(", "),
          type: c.control ? CONTROL_LABELS[c.control] : null,
          undergrads: c.enrollment,
          netPriceAverage: price(c.avgNetPrice),
          netPriceByIncome: c.netPriceByIncome && Object.fromEntries(Object.entries(c.netPriceByIncome).map(([k, v]) => [k, price(v ?? null)])),
          costOfAttendance: c.costOfAttendance,
          completionRatePercent: pct(c.completionRate),
          medianEarnings10yr: c.medianEarnings10yr,
          page: `/colleges/${c.unitId}`,
        })),
      });
    },
  });

  const detail = betaZodTool({
    name: "get_college",
    description:
      "Get College Scorecard details for one school by its UNITID (from search_colleges): net price by family income, cost of attendance, tuition, completion rate, earnings, typical debt, Pell Grant share, admission rate, and its undergraduate programs by credential (the kind most students earn there first). Pass major to check whether it offers a program, with that program's earnings and debt.",
    inputSchema: z.object({
      unitId: z.number().int().positive(),
      major: z
        .string()
        .min(2)
        .max(80)
        .optional()
        .describe("Only list programs matching this major: plain words ('computer science', 'welding') or a CIP code like '11.07'"),
    }),
    run: async ({ unitId, major }) => {
      const c = await getCollege(db, unitId);
      if (!c) return JSON.stringify({ error: "No college with that UNITID. Use search_colleges first." });

      // With a major: that major's programs, with earnings and debt. Every family the words match
      // counts, not just the top one ("computer science" is 11.07 at some colleges, 11.01 at others).
      let matched: object[] | null = null;
      if (major) {
        if (isGraduateProgram(major.trim())) return JSON.stringify({ unitId: c.unitId, name: c.name, note: GRADUATE_NOTE, page: `/colleges/${c.unitId}` });
        const family = cipFamily(major);
        const families = new Set(family ? [family] : (await findStrongPrograms(db, major, 50)).map((m) => m.cip4));
        matched = c.programs.flatMap((g) =>
          g.programs
            .filter((p) => families.has(p.cip4))
            .map((p) => ({
              credential: CREDENTIAL_LABELS[g.credentialLevel].one,
              title: p.title,
              cip4: p.cip4,
              medianEarnings4yr: p.medianEarnings4yr,
              medianDebtOfBorrowers: p.medianDebt,
            })),
        );
      }
      // Otherwise (or when nothing matched): titles by credential, capped per level, so a big
      // university's bachelor's degrees aren't crowded out by its certificates.
      const allPrograms = c.programs.map((g) => ({
        credential: g.label,
        count: g.programs.length,
        titles: g.programs.slice(0, TITLES_PER_LEVEL).map((p) => p.title),
        ...(g.programs.length > TITLES_PER_LEVEL ? { notListed: g.programs.length - TITLES_PER_LEVEL } : {}),
      }));

      const inState = c.control === 1;
      return JSON.stringify({
        unitId: c.unitId,
        name: c.name,
        place: [c.city, c.state].filter(Boolean).join(", "),
        type: c.control ? CONTROL_LABELS[c.control] : null,
        undergrads: c.enrollment,
        netPriceAverage: price(c.avgNetPrice),
        netPriceByIncome: c.netPriceByIncome && Object.fromEntries(Object.entries(c.netPriceByIncome).map(([k, v]) => [k, price(v ?? null)])),
        costOfAttendance: c.costOfAttendance,
        ...(inState ? { costOfAttendanceOutOfStateEstimate: outOfStateCost(c.costOfAttendance, c.tuitionInState, c.tuitionOutOfState) } : {}),
        tuitionInState: c.tuitionInState,
        tuitionOutOfState: c.tuitionOutOfState,
        completionRatePercent: pct(c.completionRate),
        medianEarnings10yr: c.medianEarnings10yr,
        medianDebtOfBorrowers: c.medianDebt,
        pellGrantPercent: pct(c.pellShare),
        admissionRatePercent: pct(c.admissionRate),
        // Calculators are often on vendors' sites the chat won't link, so point to our page, which does.
        netPriceCalculator: c.netPriceCalculatorUrl ? "Linked on this college's page (see page)" : null,
        page: `/colleges/${c.unitId}`,
        notes: [
          ...(inState ? [PUBLIC_IN_STATE_NOTE] : []),
          ...(c.predominantDegree === 2 ? [TRANSFER_NOTE] : []),
          `Debt: ${MEANINGS.debt}`,
        ],
        ...(matched ? { programs: matched } : {}),
        ...(matched?.length === 0
          ? { programNote: "No program here matches that major in College Scorecard data. Its website may list more. Check allPrograms." }
          : {}),
        ...(!matched?.length ? { allPrograms } : {}),
      });
    },
  });

  const aid = betaZodTool({
    name: "get_aid_guide",
    description:
      "Read College Compass's plain-language financial aid guide, in English and Spanish: how aid works, the FAFSA step by step, special situations (undocumented parents, foster youth, divorced parents), Pell and Workforce Pell, state aid, the CSS Profile and fee waivers, scholarships and scams, loans, comparing aid offers, and paying for career training. Call it with no section to see what's there. Answer aid questions from it and link the student to the section. Each result says whether a counselor has reviewed the guide yet; while it's a draft, say so and have the student confirm dates and amounts at studentaid.gov.",
    inputSchema: z.object({
      section: z.enum(AID_GUIDE_SECTION_IDS).optional(),
      language: z.enum(["en", "es"]).optional().describe("Spanish for families who prefer it"),
    }),
    run: async ({ section, language = "en" }) => JSON.stringify(aidGuideToolResult(loadGuide(language), section)),
  });

  return [search, detail, aid];
}
