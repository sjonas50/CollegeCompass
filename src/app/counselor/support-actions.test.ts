import { describe, expect, it } from "vitest";
import { supportResponse } from "@/lib/ai/safety/responses";
import { supportActions } from "./support-actions";

describe("supportActions", () => {
  it("offers every hotline the crisis message names", () => {
    const labels = supportActions(supportResponse("self_harm")).map((a) => a.label);
    expect(labels).toEqual(expect.arrayContaining(["Call 988", "Text 988", "Text HOME to 741741", "Call 911 (emergency)"]));
  });

  it("leads with Childhelp for abuse", () => {
    const actions = supportActions(supportResponse("abuse"));
    expect(actions[0]).toEqual({ href: "tel:18004224453", label: "Call Childhelp (1-800-422-4453)" });
  });
});
