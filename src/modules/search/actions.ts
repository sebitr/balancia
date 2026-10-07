"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";
import {
  actionError,
  requireGroupAccess,
  runAction,
  type ActionResult,
} from "@/lib/actions";
import { getCurrentActor } from "@/lib/security/actor";
import { AuthenticationRequiredError } from "@/lib/security/authorization";
import {
  PALETTE_QUERY_MAX,
  searchPalette,
  type PaletteResults,
} from "./service";

/**
 * The command palette's one question to the server: what matches this, among
 * the reader's groups, the people in them and the transactions of the group
 * they are in. See `service.ts`.
 *
 * An action rather than a route handler, like the switcher's
 * `loadSwitcherGroups`: it is asked from a component, on demand, and an action
 * that writes nothing carries only its answer — the page under the palette is
 * not rendered again. Actions are sent one at a time, which is the cost; the
 * palette pays it once per pause in typing rather than once per key, and drops
 * an answer to a query that has since changed.
 *
 * The group comes from the browser and is believed only once
 * `requireGroupAccess` has checked it, as every other action does: a group id
 * the reader is not in is refused before anything of it is read.
 */

const inputSchema = z.object({
  query: z.string().max(PALETTE_QUERY_MAX),
  groupId: z.guid().nullable(),
});

export async function searchPaletteAction(
  input: unknown,
): Promise<ActionResult<PaletteResults>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const t = await getTranslations("serverErrors");
    return actionError(t("malformedRequest"));
  }
  const { query, groupId } = parsed.data;

  return runAction("search.palette", async () => {
    const actor = await getCurrentActor();
    if (!actor) throw new AuthenticationRequiredError();
    const access = groupId === null ? null : await requireGroupAccess(groupId);
    return searchPalette(actor, access, query);
  });
}
