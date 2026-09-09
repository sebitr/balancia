"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getCurrentUser } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { createApiToken, revokeApiToken } from "./service";
import { serializeApiToken, type MintedApiToken } from "./serialize";
import type { TokenScope } from "./scope";

/**
 * Minting and revoking a key.
 *
 * Server Actions rather than routes, and that is the security property rather
 * than a style choice: `apiActor` in `app/api/mobile.ts` is the only thing in
 * the codebase that reads a bearer header, and it lives on the API surface. An
 * action is reached through `getCurrentUser()`, which knows nothing about
 * keys — so a key cannot mint a key, cannot revoke one, and cannot list the
 * others an account holds. There is no check anywhere enforcing that; there is
 * simply no path.
 */

export async function createApiTokenAction(input: {
  name: string;
  scope: TokenScope;
  groupId?: string | null;
}): Promise<ActionResult<MintedApiToken>> {
  const t = await getTranslations("serverErrors");

  const user = await getCurrentUser();
  if (!user) return actionError(t("signedInRequired"));

  return runAction("createApiToken", async () => {
    // A pin is only meaningful against a group this account is actually in,
    // and the check is `authorizeGroup` rather than a membership query of its
    // own — so a group somebody is not in fails here exactly as it would fail
    // on every route the key would later be pointed at, with the same
    // indistinguishable-from-missing answer.
    if (input.groupId) {
      await authorizeGroup({ ...user }, input.groupId);
    }

    const minted = await createApiToken(user.userId, {
      name: input.name,
      scope: input.scope,
      groupId: input.groupId ?? null,
    });
    revalidatePath("/settings/security");
    return {
      token: minted.token,
      record: serializeApiToken(minted.record),
    };
  });
}

/**
 * Revoking one.
 *
 * Irreversible on purpose, and so the screen asks *before* rather than
 * offering an Undo afterwards — see `toastUndoable` in `components/ui/sonner`.
 * Putting a key back would mean either storing the secret, which this whole
 * design refuses to do, or minting a different one, which is not undoing
 * anything: whatever was holding the old key stays broken either way.
 */
export async function revokeApiTokenAction(
  tokenId: string,
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");

  const user = await getCurrentUser();
  if (!user) return actionError(t("signedInRequired"));

  return runAction("revokeApiToken", async () => {
    await revokeApiToken(user.userId, tokenId);
    revalidatePath("/settings/security");
  });
}
