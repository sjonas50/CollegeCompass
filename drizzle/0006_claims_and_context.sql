ALTER TABLE "reminder_sends" ALTER COLUMN "sent_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "reminder_sends" ALTER COLUMN "sent_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "counselor_conversations" ADD COLUMN "context" text;--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD COLUMN "claimed_at" timestamp with time zone DEFAULT now() NOT NULL;