import { z } from "zod";
import { getCurrentUser } from "@/lib/security/actor";
import {
  getPreferences,
  listMutedGroups,
  savePreferences,
} from "@/modules/notifications/service";
import {
  invalidInput,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Which categories reach this reader, and which groups they have silenced.
 * The switches are all-or-nothing per category, same as the web page.
 */
export async function GET() {
  return trackRoute("/api/notifications/preferences", "GET", handleGet);
}

async function handleGet() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }
    const [preferences, mutedGroupIds] = await Promise.all([
      getPreferences(user.userId),
      listMutedGroups(user.userId),
    ]);
    return noStore({ preferences, mutedGroupIds });
  } catch (error) {
    return mobileApiError(error, "/api/notifications/preferences GET");
  }
}

const preferencesSchema = z.object({
  expenses: z.boolean(),
  settlements: z.boolean(),
  recurring: z.boolean(),
  imports: z.boolean(),
  reminders: z.boolean(),
});

export async function PUT(request: Request) {
  return trackRoute("/api/notifications/preferences", "PUT", () =>
    handlePut(request),
  );
}

async function handlePut(request: Request) {
  const body = await readJsonBody(request);
  if (body === undefined) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }
    await savePreferences(user.userId, parsed.data);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, "/api/notifications/preferences PUT");
  }
}
