import { describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { collegeTools } from "@/lib/counselor/college-tools";
import { DRAFT_NOTE, aidGuideToolResult, guideReviewForCounselor } from "./counselor";
import { guideFixture, reviewedFixture } from "./fixtures";
import { loadGuide } from ".";

const draft = guideFixture("es", ["how-aid-works", "comparing-aid-offers"]);
const reviewed = reviewedFixture(guideFixture("en"), "2026-09-15");

describe("the aid guide, as the AI counselor reads it", () => {
  it("says a draft is a draft, with the caveat the pages show", () => {
    expect(guideReviewForCounselor(draft)).toEqual({ review: "draft", updated: "2026-09-01", reviewNote: DRAFT_NOTE });
    expect(DRAFT_NOTE).toContain("a counselor hasn't reviewed it yet");
    expect(DRAFT_NOTE).toContain("confirm dates and amounts at https://studentaid.gov");
  });

  it("says when a counselor reviewed it, without the reviewer's name", () => {
    const review = guideReviewForCounselor(reviewed);
    expect(review).toEqual({ review: "counselor-reviewed", reviewedOn: "2026-09-15", updated: "2026-09-01" });
    expect(JSON.stringify(review)).not.toContain("Pat Rivera");
  });

  it("lists the sections with their pages, and the review status", () => {
    expect(aidGuideToolResult(draft)).toEqual({
      review: "draft",
      updated: "2026-09-01",
      reviewNote: DRAFT_NOTE,
      sections: [
        { id: "how-aid-works", title: "Sección how-aid-works", summary: "Una oración que resume la sección.", href: "/aid/es/how-aid-works" },
        { id: "comparing-aid-offers", title: "Sección comparing-aid-offers", summary: "Una oración que resume la sección.", href: "/aid/es/comparing-aid-offers" },
      ],
    });
  });

  it("gives one section's words, sources and page, and the review status", () => {
    const out = aidGuideToolResult(reviewed, "comparing-aid-offers");
    expect(out).toMatchObject({ title: "Section comparing-aid-offers", page: "/aid/en/comparing-aid-offers", review: "counselor-reviewed", reviewedOn: "2026-09-15" });
    expect(out).not.toHaveProperty("reviewNote");
    expect("text" in out && out.text).toBe(
      "See https://studentaid.gov for details.\n\nWhat you need\n- A\n- B\n\nSteps\n1. Make your account.\n2. Fill out the form.\n\nStart early.\n\nWatch for scams\nThe FAFSA is free.",
    );
    expect("sources" in out && out.sources).toEqual([{ title: "Federal Student Aid", url: "https://studentaid.gov/" }]);
    expect(aidGuideToolResult(draft, "how-aid-works")).toMatchObject({ review: "draft", reviewNote: DRAFT_NOTE });
  });

  it("says a planned section isn't published yet", () => {
    expect(aidGuideToolResult(draft, "loans-wisely")).toMatchObject({ note: "That section isn't published yet.", review: "draft", reviewNote: DRAFT_NOTE });
  });

  it("is what the get_aid_guide tool returns, and the tool doesn't call the guide fact-checked", async () => {
    const tool = collegeTools({} as Db).find((t) => t.name === "get_aid_guide")!;
    const description = "description" in tool ? tool.description : "";
    expect(description).not.toMatch(/fact-checked/i);
    expect(description).toContain("Each result says whether a counselor has reviewed the guide yet");
    const [first] = loadGuide("es").sections;
    const out = JSON.parse(String(await tool.run({ section: first.id, language: "es" } as never)));
    expect(out).toEqual(JSON.parse(JSON.stringify(aidGuideToolResult(loadGuide("es"), first.id))));
    expect(out.review).toBe(loadGuide("es").review.status);
    expect(JSON.parse(String(await tool.run({} as never)))).toMatchObject({ review: loadGuide("en").review.status, updated: loadGuide("en").updated });
  });
});
