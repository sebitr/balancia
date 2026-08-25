CREATE TABLE "payout_addresses" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"street" text,
	"building_number" text,
	"postal_code" text NOT NULL,
	"town" text NOT NULL,
	"country" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_addresses_street_bounded" CHECK (length("payout_addresses"."street") <= 70),
	CONSTRAINT "payout_addresses_building_bounded" CHECK (length("payout_addresses"."building_number") <= 16),
	CONSTRAINT "payout_addresses_postal_code_bounded" CHECK (length("payout_addresses"."postal_code") BETWEEN 1 AND 16),
	CONSTRAINT "payout_addresses_town_bounded" CHECK (length("payout_addresses"."town") BETWEEN 1 AND 35),
	CONSTRAINT "payout_addresses_country_format" CHECK ("payout_addresses"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "payout_addresses" ADD CONSTRAINT "payout_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;