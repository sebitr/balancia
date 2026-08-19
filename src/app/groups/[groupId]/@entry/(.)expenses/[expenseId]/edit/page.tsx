import { EntryScreen } from "../../../../entry-screen";

/** The edit drawer, opened over whatever the reader was looking at. */
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
    />
  );
}
