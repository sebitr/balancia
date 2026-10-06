import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EntryScreen } from "../../../entry-screen";

/**
 * Change a recurring expense: the entry form, opened on the rule with Repeats
 * on, saving for the entries still to come.
 *
 * This is the route a link or a refresh lands on. The Recurring screen's Edit
 * is intercepted by `@entry` and opens the same form as a drawer over the
 * list — see `../../../@entry/(.)recurring/[templateId]/edit/page.tsx` — so
 * leaving from here goes to that list rather than back through the browser.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("addEntry");
  return { title: t("editRecurringTitles.expense") };
}

export default async function EditRecurringPage({
  params,
}: PageProps<"/groups/[groupId]/recurring/[templateId]/edit">) {
  const { groupId, templateId } = await params;
  return (
    <EntryScreen groupId={groupId} dismissTo="recurring" rule={templateId} />
  );
}
