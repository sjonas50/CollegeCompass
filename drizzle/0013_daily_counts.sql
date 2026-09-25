CREATE TABLE "daily_counts" (
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "daily_counts_day_metric_pk" PRIMARY KEY("day","metric")
);
