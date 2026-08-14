import { NewEntryScreen } from "../../../expenses/new/new-entry-screen";

/**
 * The same screen, opened over the group instead of replacing it.
 *
 * Every navigation to `/groups/<id>/expenses/new` from inside the group — the
 * bottom bar's Add, the buttons on the overview, the transactions list — is
 * intercepted here, so the group stays mounted and rendered underneath while
 * the drawer is open. The URL is the real one either way, which is what keeps
 * the screen linkable and the back button honest.
 */
export default async function InterceptedNewEntryPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  return <NewEntryScreen groupId={groupId} dismissTo="back" />;
}
