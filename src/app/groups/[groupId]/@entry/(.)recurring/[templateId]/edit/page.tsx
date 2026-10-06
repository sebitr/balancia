import { EntryScreen } from "../../../../entry-screen";

/**
 * The Recurring screen's Edit, as a drawer over the list it was pressed in.
 *
 * `whenGone="nothing"` for the reason the expense drawer has it: this is the
 * slot, not the screen, and a cold link to the same URL lands on the route
 * beside this one, which still answers 404 for a rule that has gone.
 */
export default async function InterceptedEditRecurringPage({
  params,
}: {
  params: Promise<{ groupId: string; templateId: string }>;
}) {
  const { groupId, templateId } = await params;
  return (
    <EntryScreen
      groupId={groupId}
      dismissTo="back"
      rule={templateId}
      whenGone="nothing"
    />
  );
}
