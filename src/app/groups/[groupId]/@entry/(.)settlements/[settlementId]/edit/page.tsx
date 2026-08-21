import { EntryScreen } from "../../../../entry-screen";

/**
 * The same, opened over the group the repayment belongs to, and vanishing on
 * the same terms — see the expense flavour next door.
 */
export default async function InterceptedEditSettlementPage({
  params,
}: {
  params: Promise<{ groupId: string; settlementId: string }>;
}) {
  const { groupId, settlementId } = await params;
  return (
    <EntryScreen
      groupId={groupId}
      dismissTo="back"
      edit={{ kind: "settlement", id: settlementId }}
      whenGone="nothing"
    />
  );
}
