CREATE INDEX "webauthn_challenges_user_idx" ON "webauthn_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "group_members_participant_idx" ON "group_members" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "expenses_created_by_idx" ON "expenses" USING btree ("created_by_participant_id");--> statement-breakpoint
CREATE INDEX "settlements_created_by_idx" ON "settlements" USING btree ("created_by_participant_id");--> statement-breakpoint
CREATE INDEX "guest_invitations_created_by_idx" ON "guest_invitations" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "guest_sessions_participant_idx" ON "guest_sessions" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "group_join_links_created_by_idx" ON "group_join_links" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "activity_events_actor_user_idx" ON "activity_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "activity_events_actor_participant_idx" ON "activity_events" USING btree ("actor_participant_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_created_by_idx" ON "recurring_expenses" USING btree ("created_by_participant_id");--> statement-breakpoint
CREATE INDEX "attachments_uploaded_by_idx" ON "attachments" USING btree ("uploaded_by_participant_id");--> statement-breakpoint
CREATE INDEX "import_runs_created_by_idx" ON "import_runs" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "imported_fingerprints_run_idx" ON "imported_fingerprints" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX "notification_group_mutes_group_idx" ON "notification_group_mutes" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "reminders_from_idx" ON "reminders" USING btree ("from_participant_id");--> statement-breakpoint
CREATE INDEX "reminders_to_idx" ON "reminders" USING btree ("to_participant_id");