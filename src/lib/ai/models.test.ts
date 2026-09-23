import { describe, expect, it } from "vitest";
import { costMicros } from "./models";

describe("costMicros", () => {
  it("prices known models per million tokens", () => {
    // 1,000 in × $5/M + 200 out × $25/M = $0.005 + $0.005
    expect(costMicros("claude-opus-5", { input_tokens: 1000, output_tokens: 200 })).toBe(10_000);
  });

  it("charges unknown models at the highest rate so budgets fail safe", () => {
    expect(costMicros("some-future-model", { input_tokens: 1000, output_tokens: 0 })).toBe(10_000);
  });

  it("discounts cache reads and surcharges cache writes", () => {
    expect(
      costMicros("claude-sonnet-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 1000 }),
    ).toBe(Math.ceil(0.1 * 1000 * 2 + 1.25 * 1000 * 2));
  });
});
