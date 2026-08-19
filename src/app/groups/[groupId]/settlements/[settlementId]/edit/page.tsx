import { EntryScreen } from "../../../entry-screen";

/**
 * Change a repayment.
 *
 * A settlement has no detail screen — it has never had anything to show that
 * the transactions row does not already say — so this is the whole of what can
 * be done to one, and the row links straight here.
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
