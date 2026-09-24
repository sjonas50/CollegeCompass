import { describe, expect, it } from "vitest";
import { aidGuideHref, headingAnchors, neighborsIn, slugify } from "./navigation";

describe("neighborsIn", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("has no previous item at the start and no next item at the end", () => {
    expect(neighborsIn(items, "a")).toEqual({ prev: null, next: { id: "b" } });
    expect(neighborsIn(items, "c")).toEqual({ prev: { id: "b" }, next: null });
  });

  it("has both in the middle", () => {
    expect(neighborsIn(items, "b")).toEqual({ prev: { id: "a" }, next: { id: "c" } });
  });

  it("has neither when there is only one item", () => {
    expect(neighborsIn([{ id: "a" }], "a")).toEqual({ prev: null, next: null });
  });

  it("returns null for an unknown id", () => {
    expect(neighborsIn(items, "z")).toBeNull();
    expect(neighborsIn([], "a")).toBeNull();
  });
});

describe("aidGuideHref", () => {
  it("builds the index and section addresses", () => {
    expect(aidGuideHref("en")).toBe("/aid/en");
    expect(aidGuideHref("es", "how-aid-works")).toBe("/aid/es/how-aid-works");
  });
});

describe("heading anchors", () => {
  it("makes plain ASCII ids, dropping accents and punctuation", () => {
    expect(slugify("¿Qué es la FAFSA?")).toBe("que-es-la-fafsa");
    expect(slugify("Step 1: Make an FSA ID")).toBe("step-1-make-an-fsa-id");
    expect(slugify("¡¿…?!")).toBe("part");
  });

  it("gives each heading a unique id and skips blocks without one", () => {
    expect(
      headingAnchors([{ heading: "Deadlines" }, {}, { heading: "Deadlines" }, { heading: "Sources" }, { heading: "Deadlines" }]),
    ).toEqual(["deadlines", undefined, "deadlines-2", "sources-2", "deadlines-3"]);
  });

  it("never reuses the ids the page itself needs", () => {
    expect(headingAnchors([{ heading: "Main" }, { heading: "On this page" }])).toEqual(["main-2", "on-this-page-2"]);
  });
});
