ALTER TABLE "occupation_interests" ADD COLUMN "leads" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "occupation_interests_leads_idx" ON "occupation_interests" USING btree ("interest") WHERE "occupation_interests"."leads";--> statement-breakpoint
-- Mark the reference data already loaded the way `npm run data:load` does (withLeadInterests): each
-- occupation's highest-scored areas, ties included, for occupations with all six scores.
UPDATE "occupation_interests" i SET "leads" = true FROM (SELECT "occupation_code", max("score") AS top FROM "occupation_interests" GROUP BY "occupation_code" HAVING count(*) = 6) t WHERE i."occupation_code" = t."occupation_code" AND i."score" = t.top;