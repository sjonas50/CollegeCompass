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

/**
 * Records a response's usage, charging each attempt at the model that actually served it. With
 * refusal fallbacks, `usage.iterations` lists every attempt (including `fallback_message`), and the
 * top-level model may not be the one that answered.
 */
export async function recordMessageUsage(
  db: Db,
  userId: string,
  feature: AiFeature,
  requestedModel: string,
  message: { model?: string | null; usage: TokenUsage & { iterations?: UsageEntry[] | null } },
) {
  const iterations = message.usage.iterations?.filter((i) => typeof i.input_tokens === "number") ?? [];
  if (iterations.length === 0) {
    await recordUsage(db, userId, feature, message.model ?? requestedModel, message.usage);
    return;
  }
  for (const it of iterations) {
    await recordUsage(db, userId, feature, it.model ?? message.model ?? requestedModel, it);
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
