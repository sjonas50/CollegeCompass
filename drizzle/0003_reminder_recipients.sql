ALTER TABLE "reminder_sends" DROP CONSTRAINT "reminder_sends_user_id_week_start_pk";--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD COLUMN "recipient" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD CONSTRAINT "reminder_sends_user_id_week_start_recipient_pk" PRIMARY KEY("user_id","week_start","recipient");
