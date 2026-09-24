import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import * as z from "zod";
import type { Db } from "@/db";
import { AID_GUIDE_SECTION_IDS, aidGuideHref, getSection, listSections } from "../aid-guide";
import {
  CIP4_PATTERN,
  CONTROL_LABELS,
  CREDENTIAL_LABELS,
  type CollegeSearchFilters,
  collegeSearchHref,
  getCollege,
  stateFromCodeOrName,
  resolveMajorQuery,
  searchColleges,
} from "../colleges";

// Reference-data tools for college and aid questions. They read only public data (College
// Scorecard, our financial aid guide), never the student's, and take no ids from the model beyond
// a college's public UNITID.

const CREDENTIALS = { certificate: 1, associate: 2, bachelor: 3 } as const;
const CONTROLS = { public: 1, private_nonprofit: 2, for_profit: 3 } as const;
const RESULTS = 8;
const PROGRAMS = 25;

/** Net prices can be negative when grants exceed the cost; students see $0 on our pages. */
const price = (n: number | null) => (n === null ? null : Math.max(0, n));
const pct = (n: number | null) => (n === null ? null : Math.round(n * 100));

export function collegeTools(db: Db): BetaRunnableTool[] {
  const search = betaZodTool({
    name: "search_colleges",
    description:
      "Search U.S. colleges and training schools in the Department of Education's College Scorecard by major, state, type and size. Returns net price (what students paid after grants), completion rate and earnings, plus a link to our College explorer page for each. Use it before naming specific schools.",
    inputSchema: z.object({
      major: z.string().min(2).max(80).optional().describe("A major or program in plain words ('nursing', 'welding') or a 4-digit CIP code like '51.38'"),
      state: z.string().min(2).max(30).optional().describe("Two-letter state code or state name"),
      name: z.string().min(2).max(80).optional().describe("Words in the school's name"),
      credential: z.enum(["certificate", "associate", "bachelor"]).optional(),
      type: z.enum(["public", "private_nonprofit", "for_profit"]).optional(),
      size: z.enum(["small", "medium", "large"]).optional().describe("small: under 5,000 undergrads; medium: 5,000-15,000; large: over 15,000"),
      sort: z.enum(["net_price", "completion", "earnings", "name"]).optional().describe("Default: lowest net price"),
    }),
    run: async (input) => {
      const filters: CollegeSearchFilters = { sort: input.sort ?? "net_price" };
      if (input.name) filters.q = input.name;
      if (input.state) {
        const state = stateFromCodeOrName(input.state);
        if (!state) return JSON.stringify({ error: "Unknown state. Use a two-letter code like 'TX'." });
        filters.state = state;
      }
      if (input.credential) filters.credential = CREDENTIALS[input.credential];
      if (input.type) filters.control = CONTROLS[input.type];
      if (input.size) filters.size = input.size;
      let major: string | null = null;
      if (input.major) {
        if (CIP4_PATTERN.test(input.major.trim())) {
          filters.major = input.major.trim();
        } else {
          const resolved = await resolveMajorQuery(db, input.major);
          if (resolved.kind === "none") return JSON.stringify({ note: "No college programs match that major. Try a broader word." });
          if (resolved.kind === "choices") {
            return JSON.stringify({ note: "Several programs match. Search again with one of these codes.", choices: resolved.choices.slice(0, 10) });
          }
          filters.major = resolved.major.cip4;
          major = resolved.major.title;
        }
      }
      const found = await searchColleges(db, filters);
      return JSON.stringify({
        total: found.total,
        major,
        moreResults: collegeSearchHref(filters),
        results: found.results.slice(0, RESULTS).map((c) => ({
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
      "Get College Scorecard details for one school by its UNITID (from search_colleges): net price by family income, cost of attendance, tuition, completion rate, earnings, typical debt, Pell Grant share, admission rate, and programs with earnings and debt.",
    inputSchema: z.object({
      unitId: z.number().int().positive(),
      major: z.string().regex(CIP4_PATTERN).optional().describe("Only list programs in this 4-digit CIP family"),
    }),
    run: async ({ unitId, major }) => {
      const c = await getCollege(db, unitId);
      if (!c) return JSON.stringify({ error: "No college with that UNITID. Use search_colleges first." });
      const programs = c.programs.flatMap((g) =>
        g.programs
          .filter((p) => !major || p.cip4 === major)
          .map((p) => ({ credential: CREDENTIAL_LABELS[g.credentialLevel].one, title: p.title, medianEarnings4yr: p.medianEarnings4yr, medianDebt: p.medianDebt })),
      );
      return JSON.stringify({
        unitId: c.unitId,
        name: c.name,
        place: [c.city, c.state].filter(Boolean).join(", "),
        type: c.control ? CONTROL_LABELS[c.control] : null,
        undergrads: c.enrollment,
        netPriceAverage: price(c.avgNetPrice),
        netPriceByIncome: c.netPriceByIncome && Object.fromEntries(Object.entries(c.netPriceByIncome).map(([k, v]) => [k, price(v ?? null)])),
        costOfAttendance: c.costOfAttendance,
        tuitionInState: c.tuitionInState,
        tuitionOutOfState: c.tuitionOutOfState,
        completionRatePercent: pct(c.completionRate),
        medianEarnings10yr: c.medianEarnings10yr,
        medianDebt: c.medianDebt,
        pellGrantPercent: pct(c.pellShare),
        admissionRatePercent: pct(c.admissionRate),
        netPriceCalculator: c.netPriceCalculatorUrl,
        page: `/colleges/${c.unitId}`,
        programs: programs.slice(0, PROGRAMS),
        morePrograms: Math.max(0, programs.length - PROGRAMS),
      });
    },
  });

  const aid = betaZodTool({
    name: "get_aid_guide",
    description:
      "Read College Compass's financial aid guide, a fact-checked, plain-language guide in English and Spanish: how aid works, the FAFSA step by step, special situations (undocumented parents, foster youth, divorced parents), Pell and Workforce Pell, state aid, the CSS Profile and fee waivers, scholarships and scams, loans, comparing aid offers, and paying for career training. Call it with no section to see what's there. Answer aid questions from it and link the student to the section.",
    inputSchema: z.object({
      section: z.enum(AID_GUIDE_SECTION_IDS).optional(),
      language: z.enum(["en", "es"]).optional().describe("Spanish for families who prefer it"),
    }),
    run: async ({ section, language = "en" }) => {
      if (!section) return JSON.stringify({ sections: listSections(language) });
      const s = getSection(language, section);
      if (!s) return JSON.stringify({ note: "That section isn't published yet.", sections: listSections(language) });
      return JSON.stringify({
        title: s.title,
        page: aidGuideHref(language, s.id),
        text: s.blocks
          .map((b) => {
            const body = "items" in b ? b.items.map((item, i) => (b.kind === "steps" ? `${i + 1}. ${item}` : `- ${item}`)).join("\n") : b.text;
            return b.heading ? `${b.heading}\n${body}` : body;
          })
          .join("\n\n"),
        sources: s.sources,
      });
    },
  });

  return [search, detail, aid];
}
