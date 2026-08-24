import { EntryScreen } from "../../entry-screen";
import { settleIntentOf } from "@/components/entries/settle-intent";

/**
 * Add an entry: expense, income, or a repayment.
 *
 * This is the route a link, a bookmark or a refresh lands on. Navigating here
 * from inside the group is intercepted by `@entry` and never reaches this
 * file — see `../../@entry/(.)expenses/new/page.tsx` — so what this renders is
 * the drawer with no group behind it, and dismissing it has to go to the group
 * rather than back to wherever the browser came from.
 *
 * The query can name a debt to open on; it is read here as well as in the
 * intercepted route because a link somebody shared or reloaded should still
 * arrive at the repayment it names.
 */
export default async function NewEntryPage({
  params,
  searchParams,
}: PageProps<"/groups/[groupId]/expenses/new">) {
  const [{ groupId }, query] = await Promise.all([params, searchParams]);
  return (
    <EntryScreen
      groupId={groupId}
      dismissTo="group"
      settle={settleIntentOf(query)}
    />
  );
}
