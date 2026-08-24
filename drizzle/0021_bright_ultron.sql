--
-- Three categories that were missing, two that were misnamed, and nine
-- subcategories filed under the wrong parent.
--
-- `expenses.category` and `expenses.subcategory` are plain nullable text — no
-- enum, no check constraint — so every change here is an UPDATE and not a type
-- change. That is what makes it safe on a self-hosted instance: no table
-- rewrite, no dependency on the order the app and the migration restart in,
-- and a row this misses still reads, because the app normalizes legacy values
-- at render time as well (`normalizeLegacyPair`).
--
-- Nothing is deleted and nothing is inferred from a description. Every
-- statement below rewrites a value the user already chose into the place that
-- value now lives; where there is no such place, the subcategory is cleared
-- and the category kept, which is a complete and valid state.
--
-- == Categories ===========================================================
--
-- Old code   New code         Why
-- --------   --------------   --------------------------------------------
-- fees       finance_admin    `fees` only ever admitted a bank's. A tax
--                             bill, a passport renewal and an accountant
--                             are the same kind of money — the kind that
--                             buys neither goods nor an experience — and
--                             filing them as `other` is what made `other`
--                             the second-largest slice on a real spread.
-- gifts      gifts_donations  Renamed only, to say what it always held.
--                             No row changes meaning.
--
-- `personal_care`, `education` and `insurance` are new and no existing row
-- names them: they are reached from below, by the subcategory moves.
--
-- == Subcategories ========================================================
--
-- Old pair                        New pair              Why
-- -----------------------------   -------------------   -------------------
-- home/home_insurance             insurance/home        A premium is a
-- health/health_insurance         insurance/health      premium; splitting
--                                                       them by what they
--                                                       cover is what made
--                                                       them impossible to
--                                                       total.
-- shopping/beauty                 personal_care/beauty  A haircut was never
-- shopping/personal_care          personal_care/other   a thing that was
--                                                       bought.
-- entertainment/streaming         subscriptions/        What is paid for is
--                                 streaming             the subscription.
-- kids_family/school              education/school      School is what the
-- kids_family/school_supplies     education/            money bought; the
--                                 school_supplies       pupil's age is not.
-- kids_family/clothing            shopping/clothing     A child's jacket is
--                                                       a jacket.
-- kids_family/activities          activities/other      A whole category
--                                                       wearing a disguise,
--                                                       and which of its
--                                                       eight it meant is
--                                                       exactly what the row
--                                                       does not say — so it
--                                                       lands on the parent
--                                                       and says nothing
--                                                       more.
-- fees/late_fees                  finance_admin/NULL    Nothing under
--                                                       `finance_admin`
--                                                       means "late". The
--                                                       nearest survivor is
--                                                       a guess, and a guess
--                                                       filed under the
--                                                       user's name is worse
--                                                       than the blank it
--                                                       replaced.
--
-- Every other subcategory kept its code and its parent, including the whole
-- of `transport`, `groceries`, `restaurants` and the sixteen `home` codes
-- that stayed. `home` and `transport` gained codes (`down_payment`,
-- `vehicle_purchase`, …) that no existing row can name, so nothing to do.
--
-- The category rename runs first, so the pair statements can be written
-- against one spelling of each parent. Each is naturally idempotent: after
-- the first run no row matches.
--
-- `expense_category_mappings` gets the same treatment as the two expense
-- tables. Its unique indexes are on (owner, normalized_merchant) and never on
-- the category, so no rewrite here can collide — a group that taught both
-- `CSS ASSURANCE → health` and `AXA → home` simply ends with two mappings
-- that both say `insurance`, which is correct and allowed. Nothing is
-- deleted: unlike `travel` in 0019, every code here is a rename or a move,
-- and the user's judgement survives all of them.
--

--
-- Recorded spending and income.
--
UPDATE "expenses" SET "category" = 'finance_admin'
  WHERE "category" = 'fees';--> statement-breakpoint
UPDATE "expenses" SET "category" = 'gifts_donations'
  WHERE "category" = 'gifts';--> statement-breakpoint

UPDATE "expenses" SET "category" = 'insurance', "subcategory" = 'home'
  WHERE "category" = 'home' AND "subcategory" = 'home_insurance';--> statement-breakpoint
UPDATE "expenses" SET "category" = 'insurance', "subcategory" = 'health'
  WHERE "category" = 'health' AND "subcategory" = 'health_insurance';--> statement-breakpoint
UPDATE "expenses" SET "category" = 'personal_care', "subcategory" = 'beauty'
  WHERE "category" = 'shopping' AND "subcategory" = 'beauty';--> statement-breakpoint
UPDATE "expenses" SET "category" = 'personal_care', "subcategory" = 'other'
  WHERE "category" = 'shopping' AND "subcategory" = 'personal_care';--> statement-breakpoint
UPDATE "expenses" SET "category" = 'subscriptions', "subcategory" = 'streaming'
  WHERE "category" = 'entertainment' AND "subcategory" = 'streaming';--> statement-breakpoint
UPDATE "expenses" SET "category" = 'education', "subcategory" = 'school'
  WHERE "category" = 'kids_family' AND "subcategory" = 'school';--> statement-breakpoint
UPDATE "expenses" SET "category" = 'education', "subcategory" = 'school_supplies'
  WHERE "category" = 'kids_family' AND "subcategory" = 'school_supplies';--> statement-breakpoint
UPDATE "expenses" SET "category" = 'shopping', "subcategory" = 'clothing'
  WHERE "category" = 'kids_family' AND "subcategory" = 'clothing';--> statement-breakpoint
UPDATE "expenses" SET "category" = 'activities', "subcategory" = 'other'
  WHERE "category" = 'kids_family' AND "subcategory" = 'activities';--> statement-breakpoint
UPDATE "expenses" SET "subcategory" = NULL
  WHERE "category" = 'finance_admin' AND "subcategory" = 'late_fees';--> statement-breakpoint

--
-- Recurring templates, so the next generated occurrence carries a live pair.
--
UPDATE "recurring_expenses" SET "category" = 'finance_admin'
  WHERE "category" = 'fees';--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = 'gifts_donations'
  WHERE "category" = 'gifts';--> statement-breakpoint

UPDATE "recurring_expenses" SET "category" = 'insurance', "subcategory" = 'home'
  WHERE "category" = 'home' AND "subcategory" = 'home_insurance';--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = 'insurance', "subcategory" = 'health'
  WHERE "category" = 'health' AND "subcategory" = 'health_insurance';--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = 'personal_care', "subcategory" = 'beauty'
  WHERE "category" = 'shopping' AND "subcategory" = 'beauty';--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = 'personal_care', "subcategory" = 'other'
  WHERE "category" = 'shopping' AND "subcategory" = 'personal_care';--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = 'subscriptions', "subcategory" = 'streaming'
  WHERE "category" = 'entertainment' AND "subcategory" = 'streaming';--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = 'education', "subcategory" = 'school'
  WHERE "category" = 'kids_family' AND "subcategory" = 'school';--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = 'education', "subcategory" = 'school_supplies'
  WHERE "category" = 'kids_family' AND "subcategory" = 'school_supplies';--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = 'shopping', "subcategory" = 'clothing'
  WHERE "category" = 'kids_family' AND "subcategory" = 'clothing';--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = 'activities', "subcategory" = 'other'
  WHERE "category" = 'kids_family' AND "subcategory" = 'activities';--> statement-breakpoint
UPDATE "recurring_expenses" SET "subcategory" = NULL
  WHERE "category" = 'finance_admin' AND "subcategory" = 'late_fees';--> statement-breakpoint

--
-- What the classifier was taught. Left behind, these would keep answering
-- with a code the picker can no longer show, and every corrected expense
-- would re-teach it.
--
UPDATE "expense_category_mappings" SET "category" = 'finance_admin'
  WHERE "category" = 'fees';--> statement-breakpoint
UPDATE "expense_category_mappings" SET "category" = 'gifts_donations'
  WHERE "category" = 'gifts';--> statement-breakpoint

UPDATE "expense_category_mappings" SET "category" = 'insurance', "subcategory" = 'home'
  WHERE "category" = 'home' AND "subcategory" = 'home_insurance';--> statement-breakpoint
UPDATE "expense_category_mappings" SET "category" = 'insurance', "subcategory" = 'health'
  WHERE "category" = 'health' AND "subcategory" = 'health_insurance';--> statement-breakpoint
UPDATE "expense_category_mappings" SET "category" = 'personal_care', "subcategory" = 'beauty'
  WHERE "category" = 'shopping' AND "subcategory" = 'beauty';--> statement-breakpoint
UPDATE "expense_category_mappings" SET "category" = 'personal_care', "subcategory" = 'other'
  WHERE "category" = 'shopping' AND "subcategory" = 'personal_care';--> statement-breakpoint
UPDATE "expense_category_mappings" SET "category" = 'subscriptions', "subcategory" = 'streaming'
  WHERE "category" = 'entertainment' AND "subcategory" = 'streaming';--> statement-breakpoint
UPDATE "expense_category_mappings" SET "category" = 'education', "subcategory" = 'school'
  WHERE "category" = 'kids_family' AND "subcategory" = 'school';--> statement-breakpoint
UPDATE "expense_category_mappings" SET "category" = 'education', "subcategory" = 'school_supplies'
  WHERE "category" = 'kids_family' AND "subcategory" = 'school_supplies';--> statement-breakpoint
UPDATE "expense_category_mappings" SET "category" = 'shopping', "subcategory" = 'clothing'
  WHERE "category" = 'kids_family' AND "subcategory" = 'clothing';--> statement-breakpoint
UPDATE "expense_category_mappings" SET "category" = 'activities', "subcategory" = 'other'
  WHERE "category" = 'kids_family' AND "subcategory" = 'activities';--> statement-breakpoint
UPDATE "expense_category_mappings" SET "subcategory" = NULL
  WHERE "category" = 'finance_admin' AND "subcategory" = 'late_fees';
