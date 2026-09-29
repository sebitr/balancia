import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EntryScreen } from "../../entry-screen";

/**
 * Add an entry: expense, income, or a repayment.
 *
 * This is the route a link, a bookmark or a refresh lands on. Navigating here
 * from inside the group is intercepted by `@entry` and never reaches this
 * file — see `../../@entry/(.)expenses/new/page.tsx` — so what this renders is
 * the drawer with no group behind it, and dismissing it has to go to the group
 * rather than back to wherever the browser came from.
 *
 * A link can name a debt to open on. It does so in the URL's fragment, which
 * never reaches the server, so a shared or reloaded link still arrives at the
 * repayment it names — the drawer reads it on the client. See
 * `components/entries/drawer-fragment.ts` for why it is not a query.
 */

/**
 * Titled as the drawer opens, on an expense.
 *
 * Only here, not on the intercepted route beside it: a slot keeps rendering
 * its page after the reader has walked away from it (see `entry-screen.tsx`),
 * and a title from there would go on naming a drawer that had closed.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("addEntry");
  return { title: t("titles.expense") };
}

export default async function NewEntryPage({
  params,
}: PageProps<"/groups/[groupId]/expenses/new">) {
  const { groupId } = await params;
  return <EntryScreen groupId={groupId} dismissTo="group" />;
}
