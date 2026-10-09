"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getCurrentUser } from "@/lib/security/actor";
import { disconnect } from "./grants";

/**
 * Disconnecting an assistant.
 *
 * A Server Action, like minting and revoking an API key, and for the same
 * reason: `getCurrentUser()` reads a session cookie and nothing else, so an
 * assistant — which only ever holds a bearer token — cannot reach it. It can
 * not list the other assistants an account has connected, and cannot
 * disconnect itself or another. There is no check enforcing that; there is no
 * path.
 *
 * Irreversible, and so the screen asks first rather than offering an Undo: the
 * tokens are hashed, so there is nothing to put back. Connecting again is the
 * assistant's own flow, from its own side.
 */
export async function disconnectAgentAction(
  grantId: string,
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");

  const user = await getCurrentUser();
  if (!user) return actionError(t("signedInRequired"));
  if (!z.uuid().safeParse(grantId).success) {
    return actionError(t("malformedRequest"));
  }

  return runAction("disconnectAgent", async () => {
    await disconnect(user.userId, grantId);
    revalidatePath("/settings/assistants");
  });
}
