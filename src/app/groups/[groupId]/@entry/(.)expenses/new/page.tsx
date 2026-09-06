import { EntryScreen } from "../../../entry-screen";

/**
 * The same screen, opened over the group instead of replacing it.
 *
 * Every navigation to `/groups/<id>/expenses/new` from inside the group — the
 * bottom bar's Add, the buttons on the overview, the transactions list, the
 * Record actions on the settle-up screen — is intercepted here, so the group
 * stays mounted and rendered underneath while the drawer is open. The URL is
 * the real one either way, which is what keeps the screen linkable and the
 * back button honest.
 *
 * Which debt to open on, when a link named one, is in the URL's fragment and
 * read by the drawer itself; this route never sees it, and takes no search
 * params on purpose. See `components/entries/drawer-fragment.ts`.
 */
export default async function InterceptedNewEntryPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  return <EntryScreen groupId={groupId} dismissTo="back" />;
}
