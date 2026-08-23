import { EntryScreen } from "../../../entry-screen";
import { settleIntentOf } from "@/components/entries/settle-intent";

/**
 * The same screen, opened over the group instead of replacing it.
 *
 * Every navigation to `/groups/<id>/expenses/new` from inside the group — the
 * bottom bar's Add, the buttons on the overview, the transactions list, the
 * Record actions on the settle-up screen — is intercepted here, so the group
 * stays mounted and rendered underneath while the drawer is open. The URL is
 * the real one either way, which is what keeps the screen linkable and the
 * back button honest.
 */
export default async function InterceptedNewEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ groupId }, query] = await Promise.all([params, searchParams]);
  return (
    <EntryScreen
      groupId={groupId}
      dismissTo="back"
      settle={settleIntentOf(query)}
    />
  );
}
