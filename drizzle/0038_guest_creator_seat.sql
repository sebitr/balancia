ALTER TABLE "groups" ADD COLUMN "created_by_participant_id" uuid;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_participant_id_participants_id_fk" FOREIGN KEY ("created_by_participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "groups_created_by_participant_idx" ON "groups" USING btree ("created_by_participant_id");--> statement-breakpoint
--
-- A group started with no account has no owner until somebody claims a seat
-- in it, and the claim used to make whoever came first the owner — any guest
-- the creator had let in through the group link, not the creator. The new
-- column names the seat whose claim makes an owner, and `claimGuestSession`
-- now asks for it. Groups started from here on get it from
-- `createGroupAsGuest`; this fills it in for the ones started before.
--
-- The seat is read from the group's history rather than guessed. Since the
-- day guest-started groups existed, `createGroupAsGuest` has written a
-- `group.created` event in the same transaction as the group, with
-- `actor_type = 'guest'` and the creator's own participant as its actor, and
-- nothing else writes that event as a guest. Activity is append-only and never
-- pruned, so the row is still there for every such group, and it names the
-- seat outright.
--
-- That is better than the other candidate, the group's earliest participant.
-- It would give the same answer for these groups — the creator's seat is the
-- only participant the creating transaction inserts — but it needs a rule for
-- *which* groups were guest-started, and the only one on hand, "no owner and
-- no creator account", also catches an account-created group whose creator is
-- gone; `createGroup` inserts the people named at creation in the creator's
-- transaction, with the same `created_at`, so its earliest row is a coin toss.
--
-- Every guest-started group gets the column, owned or not, so that it means
-- the same thing on an old group as on a new one. Where it is read — a claim,
-- and the join link's list of names — it only counts while the group has no
-- owner, so a group whose owner is already settled is not changed by it,
-- including one an invitee took under the old rule: taking a group back from
-- somebody is for its people to decide, not for a migration.
--
UPDATE "groups" AS g
SET "created_by_participant_id" = e."actor_participant_id"
FROM "activity_events" AS e
JOIN "participants" AS p ON p."id" = e."actor_participant_id"
WHERE e."group_id" = g."id"
  AND p."group_id" = g."id"
  AND e."action" = 'group.created'
  AND e."actor_type" = 'guest'
  AND g."created_by_participant_id" IS NULL;
