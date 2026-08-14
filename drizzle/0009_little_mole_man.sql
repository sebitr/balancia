ALTER TABLE "groups" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "icon_color" text;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_icon_format" CHECK ("groups"."icon" IS NULL OR "groups"."icon" ~ '^[a-z][a-z0-9-]{0,31}$');--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_icon_color_format" CHECK ("groups"."icon_color" IS NULL OR "groups"."icon_color" ~ '^[a-z][a-z0-9-]{0,31}$');