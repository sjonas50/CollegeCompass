CREATE TABLE "college_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"unit_id" integer,
	"name" text NOT NULL,
	"kind" text DEFAULT 'college' NOT NULL,
	"status" text DEFAULT 'considering' NOT NULL,
	"deadline_type" text,
	"deadline" date,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"aid_offer" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "college_programs" (
	"unit_id" integer NOT NULL,
	"cip4" text NOT NULL,
	"title" text NOT NULL,
	"credential_level" smallint NOT NULL,
	"median_debt" integer,
	"median_earnings_4yr" integer,
	CONSTRAINT "college_programs_unit_id_cip4_credential_level_pk" PRIMARY KEY("unit_id","cip4","credential_level")
);
--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "zip" text;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "enrollment" integer;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "predominant_degree" smallint;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "highest_degree" smallint;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "net_price_calculator_url" text;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "cost_of_attendance" integer;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "tuition_in_state" integer;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "tuition_out_of_state" integer;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "pell_share" real;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "median_debt" integer;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "hbcu" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "hispanic_serving" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "tribal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "colleges" ADD COLUMN "online_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "college_list" ADD CONSTRAINT "college_list_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "college_programs" ADD CONSTRAINT "college_programs_unit_id_colleges_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."colleges"("unit_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "college_list_user_idx" ON "college_list" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "college_list_user_unit_uq" ON "college_list" USING btree ("user_id","unit_id");--> statement-breakpoint
CREATE INDEX "college_programs_cip_idx" ON "college_programs" USING btree ("cip4");--> statement-breakpoint
CREATE INDEX "colleges_name_idx" ON "colleges" USING btree ("name");