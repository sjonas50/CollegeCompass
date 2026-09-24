CREATE TABLE "assessment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instrument" text NOT NULL,
	"instrument_version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assessment_responses" (
	"attempt_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"value" smallint NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_responses_attempt_id_item_id_pk" PRIMARY KEY("attempt_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_results" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"scores" jsonb NOT NULL,
	"scoring_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_matches" (
	"run_id" uuid NOT NULL,
	"rank" smallint NOT NULL,
	"occupation_code" text NOT NULL,
	"title" text NOT NULL,
	"job_zone" smallint,
	"score" smallint NOT NULL,
	"interest_fit" smallint NOT NULL,
	"values_fit" smallint,
	CONSTRAINT "career_matches_run_id_rank_pk" PRIMARY KEY("run_id","rank")
);
--> statement-breakpoint
CREATE TABLE "match_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"interests_attempt_id" uuid NOT NULL,
	"values_attempt_id" uuid,
	"personality_attempt_id" uuid,
	"scoring_version" text NOT NULL,
	"explanation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "north_star_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"occupation_code" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occupation_values" (
	"occupation_code" text NOT NULL,
	"value" text NOT NULL,
	"score" real NOT NULL,
	CONSTRAINT "occupation_values_occupation_code_value_pk" PRIMARY KEY("occupation_code","value")
);
--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_matches" ADD CONSTRAINT "career_matches_run_id_match_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."match_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_interests_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("interests_attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_values_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("values_attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_personality_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("personality_attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "north_star_goals" ADD CONSTRAINT "north_star_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation_values" ADD CONSTRAINT "occupation_values_occupation_code_occupations_code_fk" FOREIGN KEY ("occupation_code") REFERENCES "public"."occupations"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_attempts_user_idx" ON "assessment_attempts" USING btree ("user_id","instrument","started_at");--> statement-breakpoint
CREATE INDEX "match_runs_user_idx" ON "match_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "north_star_user_occupation_uq" ON "north_star_goals" USING btree ("user_id","occupation_code");