import { cookies } from "next/headers";
import {
  COOKIE_NAME,
  COOKIE_TTL_SECONDS,
  cookieAttributes,
  decodePending,
  encodePending,
  type PendingConnection,
} from "@/modules/backup/oauth-state";

/**
 * Setting and burning the cookie that carries a connection across to the
 * provider and back. The sealing, the expiry and the checks are the domain's
 * (`oauth-state.ts`); this file is only the part that needs a request.
 */

export async function setPendingConnection(
  pending: PendingConnection,
): Promise<void> {
  (await cookies()).set(
    COOKIE_NAME,
    encodePending(pending),
    cookieAttributes(COOKIE_TTL_SECONDS),
  );
}

/** Reads the pending connection and deletes it, whether or not it is valid. */
export async function takePendingConnection(): Promise<PendingConnection | null> {
  const store = await cookies();
  const pending = decodePending(store.get(COOKIE_NAME)?.value);
  store.set(COOKIE_NAME, "", cookieAttributes(0));
  return pending;
}
