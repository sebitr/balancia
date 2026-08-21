import { EntryScreen } from "../../../entry-screen";

/**
 * Change a repayment.
 *
 * Reached from the repayment's detail screen, which is where a row in the
 * transactions list now leads. Editing is the same drawer an expense opens,
 * on the settle tab.
 */
export default async function EditSettlementPage({
  params,
}: PageProps<"/groups/[groupId]/settlements/[settlementId]/edit">) {
  const { groupId, settlementId } = await params;
  return (
    <EntryScreen
      groupId={groupId}
      dismissTo="group"
      edit={{ kind: "settlement", id: settlementId }}
    />
  );
}
