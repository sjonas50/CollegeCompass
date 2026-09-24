import { and, eq, gte, sum } from "drizzle-orm";
import type { Db } from "@/db";
import { aiUsage } from "@/db/schema";
import { env } from "@/env";
import { type AiFeature, type TokenUsage, costMicros } from "./models";

export class BudgetExceededError extends Error {
  constructor() {
    super("Monthly AI budget reached for this student");
    this.name = "BudgetExceededError";
  }
}

export async function recordUsage(db: Db, userId: string, feature: AiFeature, model: string, usage: TokenUsage) {
  await db.insert(aiUsage).values({
    userId,
    feature,
    model,
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
    costMicros: costMicros(model, usage),
  });
}

type UsageEntry = TokenUsage & { model?: string | null; type?: string };
type BilledMessage = { model?: string | null; usage: TokenUsage & { iterations?: UsageEntry[] | null } };

/**
 * Each billed attempt in a response, with the model that ran it. With refusal fallbacks,
 * `usage.iterations` lists every attempt (including `fallback_message`), and the top-level usage
 * and model cover only the one that answered.
 */
function billedAttempts(requestedModel: string, message: BilledMessage): { model: string; usage: TokenUsage }[] {
  const iterations = message.usage.iterations?.filter((i) => typeof i.input_tokens === "number") ?? [];
  if (iterations.length === 0) return [{ model: message.model ?? requestedModel, usage: message.usage }];
  return iterations.map((it) => ({ model: it.model ?? message.model ?? requestedModel, usage: it }));
}

/** A response's cost in millionths of a dollar, each attempt priced at the model that ran it. */
export function messageCostMicros(requestedModel: string, message: BilledMessage): number {
  return billedAttempts(requestedModel, message).reduce((total, a) => total + costMicros(a.model, a.usage), 0);
}

/** Records a response's usage, charging each attempt at the model that actually ran it. */
export async function recordMessageUsage(db: Db, userId: string, feature: AiFeature, requestedModel: string, message: BilledMessage) {
  for (const a of billedAttempts(requestedModel, message)) {
    await recordUsage(db, userId, feature, a.model, a.usage);
  }
}

function startOfMonthUtc(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function monthSpendMicros(db: Db, userId: string, now = new Date()) {
  const [row] = await db
    .select({ total: sum(aiUsage.costMicros) })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, startOfMonthUtc(now))));
  return Number(row?.total ?? 0);
}

/**
 * Throws once a student has used their monthly AI budget. Safety checks don't call this:
 * they must always run.
 */
export async function assertWithinBudget(db: Db, userId: string, now = new Date()) {
  const budgetMicros = env().AI_MONTHLY_BUDGET_USD * 1_000_000;
  if ((await monthSpendMicros(db, userId, now)) >= budgetMicros) throw new BudgetExceededError();
}
