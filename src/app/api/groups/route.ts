import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getCurrentActor, getCurrentUser } from "@/lib/security/actor";
import { loadHomeOverview } from "@/modules/balances/overview";
import { createGroupSchema } from "@/modules/groups/schemas";
import { createGroup } from "@/modules/groups/service";
import {
  invalidInput,
  mobileApiError,
  noStore,
  readJsonBody,
  serializeHomeOverview,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The home screen's read: every group the account belongs to, bucketed by
 * whether it needs the reader, with the same net position the web header
 * shows. Guests are pinned to one group and have no home; the whoami route
 * tells them which group is theirs, and they read it directly.
 */
export async function GET() {
  return trackRoute("/api/groups", "GET", handleGet);
}

async function handleGet() {
  try {
    const actor = await getCurrentActor();
    if (!actor) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }
    if (actor.kind !== "user") {
      return noStore(
        { error: "Sign in with an account to list groups." },
        { status: 403 },
      );
    }

    const db = getDb();
    const [preferences] = await db
      .select({ preferredCurrency: users.preferredCurrency })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);

    const overview = await loadHomeOverview(actor.userId, {
      preferredCurrency: preferences?.preferredCurrency ?? null,
    });
    return noStore(serializeHomeOverview(overview));
  } catch (error) {
    return mobileApiError(error, "/api/groups GET");
  }
}

/**
 * Creating a group away from a desk. Same schema as the web form, with the
 * same convenience: the owner's display name defaults to their account name,
 * so the client only sends it when the person typed something else.
 */
export async function POST(request: Request) {
  return trackRoute("/api/groups", "POST", () => handlePost(request));
}

async function handlePost(request: Request) {
  const body = await readJsonBody(request);
  if (body === undefined || typeof body !== "object" || body === null) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }

    const raw = body as Record<string, unknown>;
    const parsed = createGroupSchema.safeParse({
      name: raw.name,
      description: raw.description ?? "",
      icon: raw.icon ?? "",
      iconColor: raw.iconColor ?? "",
      currencyMode: raw.currencyMode,
      baseCurrency: raw.baseCurrency || undefined,
      timezone: raw.timezone,
      ownerDisplayName: raw.ownerDisplayName || user.name,
      participantNames: Array.isArray(raw.participantNames)
        ? raw.participantNames
            .map((value) => String(value))
            .filter((value) => value.trim() !== "")
        : [],
    });
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }

    const created = await createGroup(user, parsed.data);
    return noStore(
      { groupId: created.id, participantId: created.participantId },
      { status: 201 },
    );
  } catch (error) {
    return mobileApiError(error, "/api/groups POST");
  }
}
