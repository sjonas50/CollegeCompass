ALTER TABLE "access_grants" ADD COLUMN "for_user_id" uuid;--> statement-breakpoint
ALTER TABLE "parent_invites" ADD COLUMN "sent_to" text;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_for_user_id_users_id_fk" FOREIGN KEY ("for_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;