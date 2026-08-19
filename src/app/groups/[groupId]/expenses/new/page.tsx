import { EntryScreen } from "../../entry-screen";

/**
 * Add an entry: expense, income, or a repayment.
 *
 * This is the route a link, a bookmark or a refresh lands on. Navigating here
 * from inside the group is intercepted by `@entry` and never reaches this
 * file — see `../../@entry/(.)expenses/new/page.tsx` — so what this renders is
 * the drawer with no group behind it, and dismissing it has to go to the group
 * rather than back to wherever the browser came from.
 */
export default async function NewEntryPage({
  params,
}: PageProps<"/groups/[groupId]/expenses/new">) {
  const { groupId } = await params;
  return <EntryScreen groupId={groupId} dismissTo="group" />;
}
