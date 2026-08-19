import { z } from "zod";
import { getCurrentUser } from "@/lib/security/actor";
import { markRead } from "@/modules/notifications/service";
import {
  invalidInput,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

const readSchema = z.object({
  /** Omit to mark everything read — the inbox's one bulk gesture. */
  ids: z.array(z.uuid()).max(100).optional(),
});

/** Marks notifications read; only ever the reader's own. */
export async function POST(request: Request) {
  return trackRoute("/api/notifications/read", "POST", () =>
    handlePost(request),
  );
}

async function handlePost(request: Request) {
  const body = await readJsonBody(request);
  const parsed = readSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }
    await markRead(user.userId, parsed.data.ids);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, "/api/notifications/read POST");
  }
}
