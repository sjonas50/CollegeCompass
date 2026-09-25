import { describe, expect, it } from "vitest";
import { contentForState, validateContent } from "../../validate";
import { tnContent } from "./content-tn";
import { txContent } from "./content-tx";
import { utContent } from "./content-ut";
import { testFamilies } from "./families";

// The engine's test content must follow the contracts' schema and pass the same validator the
// real content does, so the engine is tested against shapes the content builder can produce.

describe("engine test content", () => {
  it("passes the content validator for all three states", () => {
    const states = [txContent(), tnContent(), utContent()];
    const result = validateContent({
      rules: states.flatMap((c) => c.rules.map((raw) => ({ label: raw.id, raw }))),
      genericCatalogs: states.map((c) => ({ label: c.genericCatalog.id, raw: c.genericCatalog })),
      facts: states.map((c) => ({ label: c.facts.id, raw: c.facts })),
      families: { label: "families", raw: testFamilies() },
    });
    expect(result.ok ? [] : result.issues).toEqual([]);
    if (!result.ok) return;
    for (const state of ["TX", "TN", "UT"] as const) expect(contentForState(result.content, state)).not.toBeNull();
  });

  it("only uses invented quotes on example.org sources", () => {
    for (const c of [txContent(), tnContent(), utContent()]) {
      for (const file of [...c.rules, c.genericCatalog, c.facts]) {
        for (const source of Object.values(file.sources)) expect(source.url).toMatch(/^https:\/\/example\.org\//);
        for (const cite of file.citations) expect(cite.quote).toMatch(/^Fixture: /);
      }
    }
  });
});
