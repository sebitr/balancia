--
-- Subcategories, and the end of five categories that were saying the same
-- thing three different ways.
--
-- `expenses.category` has always been plain nullable text — no enum, no check
-- constraint — so retiring a code is an UPDATE and not a type change. That is
-- what makes this safe on a self-hosted instance: no table rewrite, no
-- dependency on the order the app and the migration restart in, and an old
-- row whose code is not rewritten still reads (the app normalizes legacy
-- values at render time as well; see `normalizeLegacyCategory`).
--
-- Old code    New code       Why
-- ---------   ------------   -----------------------------------------------
-- housing     home           Rent, bills and upkeep were one place all along.
-- utilities   home           Which of the three a plumber's invoice belonged
-- household   home           to was a coin toss that split a flat-share's
--                            largest expense across three slices of the
--                            spread. The distinction that mattered moved down
--                            a level, where it may also be left blank.
-- family      kids_family    Renamed only. No row changes meaning.
-- travel      other          `travel` named an occasion, not a kind of
--                            spending: its rows are flights, hotel nights and
--                            museum tickets mixed together. Nothing in the
--                            row says which, so nothing here guesses — see
--                            below.
--
-- No subcategory is inferred for any migrated row. The only evidence a row
-- carries is its free-text description, and reading one to decide that a 2019
-- expense called "août" was electricity rather than rent would be inventing a
-- fact and filing it under the user's name. Every migrated row gets
-- `subcategory = NULL`, which is a complete and valid state — the picker
-- offers the second step, it never demands it.
--
-- ADD COLUMN statements are IF NOT EXISTS so that an instance which was
-- half-upgraded by hand converges instead of failing; the UPDATEs are
-- naturally idempotent, since after the first run no row matches.
--
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "subcategory" text;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN IF NOT EXISTS "subcategory" text;--> statement-breakpoint
ALTER TABLE "expense_category_mappings" ADD COLUMN IF NOT EXISTS "subcategory" text;--> statement-breakpoint

--
-- Recorded spending and income.
--
UPDATE "expenses" SET "category" = 'home'
  WHERE "category" IN ('housing', 'utilities', 'household');--> statement-breakpoint
UPDATE "expenses" SET "category" = 'kids_family'
  WHERE "category" = 'family';--> statement-breakpoint
UPDATE "expenses" SET "category" = 'other'
  WHERE "category" = 'travel';--> statement-breakpoint

--
-- Recurring templates, so the next generated occurrence carries a live code.
--
UPDATE "recurring_expenses" SET "category" = 'home'
  WHERE "category" IN ('housing', 'utilities', 'household');--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = 'kids_family'
  WHERE "category" = 'family';--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = 'other'
  WHERE "category" = 'travel';--> statement-breakpoint

--
-- What the classifier was taught. Left behind, these would keep answering
-- with a code the picker can no longer show, and every corrected expense
-- would re-teach it.
--
-- The two merges can collide: a group that taught `IKEA → household` and
-- `EDF → utilities` now has two rows both saying `home`, which is fine — the
-- unique index is on (owner, merchant), not on the category. Nothing here can
-- create a duplicate merchant.
--
UPDATE "expense_category_mappings" SET "category" = 'home'
  WHERE "category" IN ('housing', 'utilities', 'household');--> statement-breakpoint
UPDATE "expense_category_mappings" SET "category" = 'kids_family'
  WHERE "category" = 'family';--> statement-breakpoint
--
-- A learned `travel` mapping is deleted rather than rewritten. The others are
-- renames — the user's judgement survives them. This one is not: someone who
-- taught this group that "EASYJET" means travel did not thereby teach it that
-- EASYJET means `other`, and a mapping to the fallback is worse than none at
-- all, because it outranks every rule that would now say `transport`.
--
DELETE FROM "expense_category_mappings" WHERE "category" = 'travel';
