import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared plumbing for the paid eval scripts (eval-counselor, eval-safety): a spend cap, an
 * up-front cost estimate, and a stop on account errors, so a run can't go past the spend that was
 * approved or keep sending requests that can only fail.
 */

/** The cap for one run when EVAL_MAX_SPEND isn't set, in dollars. */
export const DEFAULT_MAX_SPEND_USD = 3;

const MICROS_PER_DOLLAR = 1_000_000;

export const dollars = (micros: number) => `$${(micros / MICROS_PER_DOLLAR).toFixed(2)}`;

/** EVAL_MAX_SPEND in dollars ("8", "2.50") as millionths of a dollar; unset means the default. */
export function maxSpendMicros(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_MAX_SPEND_USD * MICROS_PER_DOLLAR;
  const usd = Number(value);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error(`EVAL_MAX_SPEND must be a dollar amount above 0, like "5" (got "${value}").`);
  return Math.round(usd * MICROS_PER_DOLLAR);
}

/**
 * What a run will likely cost, from past runs' cost per case. `fits` is false when that's more
 * than the cap: the run shouldn't start, since it would stop partway and leave a partial result.
 */
export function planRun(cases: number, perCaseMicros: number, capMicros: number) {
  const projectedMicros = cases * perCaseMicros;
  // A cap to suggest, with room for cases that cost more than usual (whole dollars).
  const suggestedCapUsd = Math.ceil((projectedMicros * 1.25) / MICROS_PER_DOLLAR);
  return { projectedMicros, fits: projectedMicros <= capMicros, suggestedCapUsd };
}

/** Prints the estimate (and a full run's, when only some cases run) and returns whether the run may start. */
export function announcePlan(cases: number, allCases: number, perCaseMicros: number, capMicros: number): boolean {
  const plan = planRun(cases, perCaseMicros, capMicros);
  console.log(
    `${cases} cases: about ${dollars(plan.projectedMicros)} (about ${dollars(perCaseMicros)} each, from past runs with the default models)` +
      `${cases < allCases ? `; all ${allCases}: about ${dollars(allCases * perCaseMicros)}` : ""}. Spend cap: ${dollars(capMicros)} (EVAL_MAX_SPEND).`,
  );
  if (!plan.fits) {
    console.error(
      `\nNot started: that's more than the spend cap. Run fewer cases with a filter, or set EVAL_MAX_SPEND=${plan.suggestedCapUsd} if that spend is approved.`,
    );
  }
  return plan.fits;
}

/**
 * A billing or auth failure (no credit, a bad or revoked key). Every later request fails the same
 * way, so the run stops instead of sending the rest.
 */
export function isAccountError(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError)) return false;
  return error.status === 401 || error.status === 403 || (error.status === 400 && /credit balance/i.test(error.message));
}

export type CappedRun<C, R> = {
  done: { item: C; result: R }[];
  /** Threw before finishing: not scored. */
  errored: { item: C; message: string }[];
  /** Never started, because the spend cap or an account error stopped the run first. */
  notRun: C[];
  spentMicros: number;
  stoppedBy: "spend cap" | "account error" | null;
};

/**
 * Runs items a few at a time. `run` reports spend through `charge` as each request finishes, so
 * a failed item's spend counts too. An item starts only while the spend so far, plus a full item's
 * cost for each running one and the new one, stays under the cap; an item's cost is the estimate,
 * or the average so far when that's higher. An account error stops the run.
 */
export async function runCapped<C, R>(
  items: readonly C[],
  opts: {
    concurrency: number;
    capMicros: number;
    estimateMicros: number;
    run: (item: C, charge: (micros: number) => void) => Promise<R>;
    onDone?: (item: C, result: R) => void;
    onError?: (item: C, message: string) => void;
  },
): Promise<CappedRun<C, R>> {
  const queue = [...items];
  const out: CappedRun<C, R> = { done: [], errored: [], notRun: [], spentMicros: 0, stoppedBy: null };
  let running = 0;
  let finished = 0;
  const charge = (micros: number) => {
    out.spentMicros += micros;
  };
  const perItem = () => Math.max(opts.estimateMicros, finished ? out.spentMicros / finished : 0);

  const worker = async () => {
    while (queue.length && !out.stoppedBy) {
      if (out.spentMicros + (running + 1) * perItem() > opts.capMicros) {
        // With others running, leave the rest to them: they check again as each one finishes.
        if (running === 0) out.stoppedBy = "spend cap";
        return;
      }
      const item = queue.shift()!;
      running++;
      try {
        const result = await opts.run(item, charge);
        out.done.push({ item, result });
        opts.onDone?.(item, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        out.errored.push({ item, message });
        opts.onError?.(item, message);
        if (isAccountError(error)) out.stoppedBy = "account error";
      } finally {
        running--;
        finished++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  out.notRun = queue;
  return out;
}

/** The lines every eval prints about cases it couldn't score, or none. */
export function unscoredReport<C>(run: CappedRun<C, unknown>, label: (item: C) => string): string[] {
  const lines: string[] = [];
  if (run.errored.length) {
    lines.push(`\n${run.errored.length} errored (not scored):`);
    for (const e of run.errored) lines.push(`  ${label(e.item)}: ${e.message.slice(0, 300)}`);
  }
  if (run.notRun.length) {
    lines.push(`\n${run.notRun.length} not run (stopped by ${run.stoppedBy ?? "an earlier stop"}).`);
  }
  if (run.stoppedBy === "account error") {
    lines.push("Stopped: the API account refused the request (no credit, or a bad key). Fix that before running again.");
  }
  if (run.stoppedBy === "spend cap") {
    lines.push(`Stopped at the spend cap. Raise EVAL_MAX_SPEND only if more spend is approved.`);
  }
  return lines;
}
