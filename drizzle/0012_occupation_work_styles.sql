CREATE TABLE "occupation_work_styles" (
	"occupation_code" text NOT NULL,
	"style" text NOT NULL,
	"impact" real NOT NULL,
	"distinctive_rank" smallint,
	CONSTRAINT "occupation_work_styles_occupation_code_style_pk" PRIMARY KEY("occupation_code","style")
);
--> statement-breakpoint
ALTER TABLE "occupation_work_styles" ADD CONSTRAINT "occupation_work_styles_occupation_code_occupations_code_fk" FOREIGN KEY ("occupation_code") REFERENCES "public"."occupations"("code") ON DELETE cascade ON UPDATE no action;