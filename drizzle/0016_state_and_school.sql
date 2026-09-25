CREATE TABLE "schools" (
	"school_ref" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"release" text NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"state" text NOT NULL,
	"lea_id" text,
	"lea_name" text,
	"grade_low" smallint,
	"grade_high" smallint,
	"grades" smallint[] NOT NULL,
	"school_type" text NOT NULL,
	"charter" boolean DEFAULT false NOT NULL,
	"virtual" boolean DEFAULT false NOT NULL,
	"shared_time" boolean DEFAULT false NOT NULL,
	"website" text,
	"search_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_schools" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"choice" text NOT NULL,
	"school_ref" text,
	"not_listed_name" text,
	"from_school_year" smallint NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_schools_user_id_role_pk" PRIMARY KEY("user_id","role"),
	CONSTRAINT "student_schools_listed_ref" CHECK (("student_schools"."choice" = 'listed') = ("student_schools"."school_ref" is not null))
);
--> statement-breakpoint
ALTER TABLE "student_courses" ADD COLUMN "course_type_id" text;--> statement-breakpoint
ALTER TABLE "student_courses" ADD COLUMN "course_type_source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_state" text;--> statement-breakpoint
ALTER TABLE "student_schools" ADD CONSTRAINT "student_schools_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schools_state_idx" ON "schools" USING btree ("state");--> statement-breakpoint
CREATE INDEX "schools_search_idx" ON "schools" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_state_code" CHECK ("users"."home_state" ~ '^[A-Z]{2}$');