CREATE TABLE "student_plan_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"targets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"choices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cohort" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dismissed" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_plan_prefs" ADD CONSTRAINT "student_plan_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;