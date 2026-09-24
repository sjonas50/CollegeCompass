CREATE TABLE "counselor_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"concern_flagged" boolean DEFAULT false NOT NULL,
	"memory_processed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counselor_memory" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"notes" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counselor_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_sends" (
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_sends_user_id_week_start_pk" PRIMARY KEY("user_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "student_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"level" text DEFAULT 'regular' NOT NULL,
	"grade_level" smallint NOT NULL,
	"term" text DEFAULT 'full_year' NOT NULL,
	"credits" real DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"final_grade" text,
	"high_school_credit" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_milestones" (
	"user_id" uuid NOT NULL,
	"milestone_id" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_milestones_user_id_milestone_id_pk" PRIMARY KEY("user_id","milestone_id")
);
--> statement-breakpoint
CREATE TABLE "weekly_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"text" text NOT NULL,
	"milestone_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "grade_school_year" smallint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reminders_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "counselor_conversations" ADD CONSTRAINT "counselor_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counselor_memory" ADD CONSTRAINT "counselor_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counselor_messages" ADD CONSTRAINT "counselor_messages_conversation_id_counselor_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."counselor_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD CONSTRAINT "reminder_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_courses" ADD CONSTRAINT "student_courses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_milestones" ADD CONSTRAINT "student_milestones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_steps" ADD CONSTRAINT "weekly_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counselor_conversations_user_idx" ON "counselor_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "counselor_messages_conversation_idx" ON "counselor_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "student_courses_user_idx" ON "student_courses" USING btree ("user_id","grade_level");--> statement-breakpoint
CREATE INDEX "weekly_steps_user_week_idx" ON "weekly_steps" USING btree ("user_id","week_start");--> statement-breakpoint
-- Existing students' grades applied to the 2026-27 school year.
UPDATE "users" SET "grade_school_year" = 2026 WHERE "role" = 'student' AND "grade_school_year" IS NULL;
