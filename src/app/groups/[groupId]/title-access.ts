import { requireGroupAccess } from "@/lib/actions";
import type { GroupAccess } from "@/lib/security/authorization";

/**
 * The group a page title is being written for, or null for a reader who may
 * not see it.
 *
 * A screen whose title names something in the group — the group itself, an
 * entry — has to read it, and `generateMetadata` is resolved alongside the
 * layout rather than after it, so it can be asked about a group the layout is
 * in the middle of refusing. The layout answers that reader, with the sign-in
 * screen or a 404; a title is no place to answer them a second time, and an
 * authorization error thrown from here would reach the error boundary instead
 * of either. So a refusal here is simply no title, and the root layout's
 * "Balancia" stands.
 */
export async function titleAccess(
  groupId: string,
): Promise<GroupAccess | null> {
  try {
    return await requireGroupAccess(groupId);
  } catch {
    return null;
  }
}
