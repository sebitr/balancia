import { z } from "zod";
import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import {
  listRemindRecipients,
  ReminderError,
  sendReminder,
} from "@/modules/reminders/service";
import {
  invalidInput,
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Reminders. GET lists who could be asked — only people who owe the reader,
 * with the channel their message would take and whether the 24-hour limit is
 * still running. POST sends one; who owes what and which channel it takes are
 * re-derived server-side, exactly as the Server Action does.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/reminders">,
) {
  return trackRoute("/api/groups/[groupId]/reminders", "GET", () =>
    handleGet(context),
  );
}

async function handleGet(
  context: RouteContext<"/api/groups/[groupId]/reminders">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const recipients = await listRemindRecipients(access);
    return noStore({ recipients });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/reminders GET", {
      groupId,
    });
  }
}

const sendSchema = z.object({
  toParticipantId: z.uuid(),
  message: z.string().trim().min(1, "Write the reminder.").max(1000),
  logToActivity: z.boolean().default(false),
});

export async function POST(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/reminders">,
) {
  return trackRoute("/api/groups/[groupId]/reminders", "POST", () =>
    handlePost(request, context),
  );
}

async function handlePost(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/reminders">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }
  const body = await readJsonBody(request);
  if (body === undefined) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    const result = await sendReminder(access, parsed.data);
    return noStore(result);
  } catch (error) {
    // The service's refusals — locked, nothing owed, unknown debtor — are
    // written for people; pass them through as input problems.
    if (error instanceof ReminderError) {
      return noStore({ error: error.message }, { status: 422 });
    }
    return mobileApiError(error, "/api/groups/[groupId]/reminders POST", {
      groupId,
    });
  }
}
