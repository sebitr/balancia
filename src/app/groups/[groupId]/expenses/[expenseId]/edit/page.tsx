import { EntryScreen } from "../../../entry-screen";

/**
 * Change an entry, on the screen it was written on.
 *
 * Editing used to have a form of its own, which over time became a different
 * and worse one: four dropdowns, no receipt scanner, no category suggestion,
 * and no way to say that what had been filed as an expense was really income
 * or a repayment. It is the same drawer now, with the entry already in it.
 */
export default async function EditExpensePage({
  params,
}: PageProps<"/groups/[groupId]/expenses/[expenseId]/edit">) {
  const { groupId, expenseId } = await params;
  return (
    <EntryScreen
      groupId={groupId}
      dismissTo="group"
      edit={{ kind: "expense", id: expenseId }}
    />
  );
}
