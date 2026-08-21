import { EntryScreen } from "../../../../entry-screen";

/**
 * The edit drawer, opened over whatever the reader was looking at.
 *
 * `whenGone="nothing"` because this is the slot, not the screen: a cold link
 * to the same URL lands on the route next to this one, which still answers 404.
 */
export default async function InterceptedEditExpensePage({
  params,
}: {
  params: Promise<{ groupId: string; expenseId: string }>;
}) {
  const { groupId, expenseId } = await params;
  return (
    <EntryScreen
      groupId={groupId}
      dismissTo="back"
      edit={{ kind: "expense", id: expenseId }}
      whenGone="nothing"
    />
  );
}
