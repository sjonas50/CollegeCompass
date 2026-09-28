import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_SPEND_USD, isAccountError, maxSpendMicros, planRun, runCapped, unscoredReport } from "../scripts/lib/eval-run";

// The paid eval scripts share this runner: it must never let a run go past its spend cap, and it
// must stop at the first sign the account can't take requests.

const apiError = (status: number, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type: "invalid_request_error", message } }, undefined, new Headers());

const NO_CREDIT = apiError(
  400,
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
);

describe("the eval spend cap", () => {
  it("defaults to a few dollars and reads EVAL_MAX_SPEND in dollars", () => {
    expect(maxSpendMicros(undefined)).toBe(DEFAULT_MAX_SPEND_USD * 1_000_000);
    expect(maxSpendMicros("")).toBe(DEFAULT_MAX_SPEND_USD * 1_000_000);
    expect(maxSpendMicros("8")).toBe(8_000_000);
    expect(maxSpendMicros("2.50")).toBe(2_500_000);
    for (const bad of ["abc", "0", "-1", "$5"]) expect(() => maxSpendMicros(bad), bad).toThrow(/EVAL_MAX_SPEND/);
  });

  it("won't start a run projected past the cap, and suggests a cap with room to spare", () => {
    // 85 counselor cases at about $0.09 each.
    expect(planRun(85, 90_000, 3_000_000)).toEqual({ projectedMicros: 7_650_000, fits: false, suggestedCapUsd: 10 });
    expect(planRun(6, 90_000, 3_000_000)).toMatchObject({ projectedMicros: 540_000, fits: true });
  });
});

describe("runCapped", () => {
  const items = ["a", "b", "c", "d", "e", "f"];

  it("runs every item under the cap and counts what each one charged", async () => {
    const run = await runCapped(items, {
      concurrency: 3,
      capMicros: 10,
      estimateMicros: 1,
      run: async (item, charge) => {
        charge(1);
        return item.toUpperCase();
      },
    });
    expect(run.done.map((d) => d.result).sort()).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(run).toMatchObject({ errored: [], notRun: [], spentMicros: 6, stoppedBy: null });
  });

  it("stops starting items before the spend passes the cap", async () => {
    const run = await runCapped(items, {
      concurrency: 1,
      capMicros: 3.5,
      estimateMicros: 1,
      run: async (item, charge) => charge(1),
    });
    expect(run.done).toHaveLength(3);
    expect(run.notRun).toEqual(["d", "e", "f"]);
    expect(run).toMatchObject({ spentMicros: 3, stoppedBy: "spend cap" });
  });

  it("uses the average so far when items cost more than estimated", async () => {
    // Estimated at 0.5 each, they cost 1: after three, a fourth would pass 3.6.
    const run = await runCapped(items, { concurrency: 1, capMicros: 3.6, estimateMicros: 0.5, run: async (_, charge) => charge(1) });
    expect(run.done).toHaveLength(3);
    expect(run.spentMicros).toBeLessThanOrEqual(3.6);
  });

  it("keeps room for items still running, so parallel items can't overshoot together", async () => {
    let running = 0;
    let most = 0;
    const run = await runCapped(items, {
      concurrency: 4,
      capMicros: 2.5,
      estimateMicros: 1,
      run: async (_, charge) => {
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        charge(1);
        running--;
      },
    });
    expect(most).toBe(2);
    expect(run.spentMicros).toBe(2);
    expect(run).toMatchObject({ stoppedBy: "spend cap" });
    expect(run.notRun).toHaveLength(4);
  });

  it("counts spend from an item that failed partway", async () => {
    const run = await runCapped(["a"], {
      concurrency: 1,
      capMicros: 10,
      estimateMicros: 1,
      run: async (_, charge) => {
        charge(2);
        throw new Error("judge returned no verdict");
      },
    });
    expect(run.spentMicros).toBe(2);
    expect(run.errored).toEqual([{ item: "a", message: "judge returned no verdict" }]);
    expect(run.done).toEqual([]);
  });

  it("keeps going after an ordinary error, but stops the queue on a billing or auth error", async () => {
    const onError = vi.fn();
    const ordinary = await runCapped(items, {
      concurrency: 1,
      capMicros: 100,
      estimateMicros: 1,
      run: async (item) => {
        if (item === "b") throw apiError(529, "Overloaded");
        return item;
      },
      onError,
    });
    expect(ordinary.done).toHaveLength(5);
    expect(ordinary.stoppedBy).toBeNull();
    expect(onError).toHaveBeenCalledWith("b", expect.stringContaining("Overloaded"));

    const sent: string[] = [];
    const broke = await runCapped(items, {
      concurrency: 2,
      capMicros: 100,
      estimateMicros: 1,
      run: async (item) => {
        sent.push(item);
        if (item === "b") throw NO_CREDIT;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return item;
      },
    });
    expect(broke.stoppedBy).toBe("account error");
    expect(sent).toEqual(["a", "b"]);
    expect(broke.notRun).toEqual(["c", "d", "e", "f"]);
    expect(broke.errored.map((e) => e.item)).toEqual(["b"]);
  });

  it("reports cases it couldn't score, so a partial run doesn't read as a regression", async () => {
    const run = await runCapped(items, {
      concurrency: 1,
      capMicros: 100,
      estimateMicros: 1,
      run: async (item) => {
        if (item === "c") throw NO_CREDIT;
        return item;
      },
    });
    const report = unscoredReport(run, (item) => `case-${item}`).join("\n");
    expect(report).toContain("1 errored (not scored)");
    expect(report).toContain("case-c: 400");
    expect(report).toContain("3 not run (stopped by account error)");
    expect(report).toMatch(/no credit, or a bad key/);
    expect(unscoredReport({ done: [], errored: [], notRun: [], spentMicros: 0, stoppedBy: null }, String)).toEqual([]);
  });
});

describe("isAccountError", () => {
  it("is true for no credit, a bad key or no permission, and false for anything worth retrying", () => {
    expect(isAccountError(NO_CREDIT)).toBe(true);
    expect(isAccountError(apiError(401, "invalid x-api-key"))).toBe(true);
    expect(isAccountError(apiError(403, "Your API key does not have permission"))).toBe(true);
    expect(isAccountError(apiError(400, "max_tokens: must be at most 64000"))).toBe(false);
    expect(isAccountError(apiError(429, "Number of requests has exceeded your rate limit"))).toBe(false);
    expect(isAccountError(apiError(529, "Overloaded"))).toBe(false);
    expect(isAccountError(new Error("credit balance is too low"))).toBe(false);
  });
});
