DROP INDEX "counselor_messages_conversation_idx";--> statement-breakpoint
ALTER TABLE "counselor_messages" ADD COLUMN "seq" bigint;--> statement-breakpoint
-- Number existing messages in the order they were written, not the order Postgres stores them.
UPDATE "counselor_messages" m SET "seq" = o.rn FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn FROM "counselor_messages") o WHERE m."id" = o."id";--> statement-breakpoint
ALTER TABLE "counselor_messages" ALTER COLUMN "seq" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "counselor_messages" ALTER COLUMN "seq" ADD GENERATED ALWAYS AS IDENTITY (sequence name "counselor_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
SELECT setval('counselor_messages_seq_seq', COALESCE((SELECT max("seq") FROM "counselor_messages"), 0) + 1, false);--> statement-breakpoint
CREATE INDEX "counselor_messages_conversation_idx" ON "counselor_messages" USING btree ("conversation_id","seq");
