"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  actionError,
  requireGroupAccess,
  runAction,
  type ActionResult,
} from "@/lib/actions";
import { getCurrentUser } from "@/lib/security/actor";
import {
  addParticipantSchema,
  createGroupSchema,
  createInvitationSchema,
  groupSplitDefaultSchema,
  updateGroupSchema,
} from "./schemas";
import {
  addParticipant,
  createGroup,
  createInvitation,
  deleteGroup,
  removeParticipant,
  restoreParticipant,
  revokeInvitation,
  setGroupArchived,
  setGroupSplitDefault,
  updateGroup,
  updateParticipant,
} from "./service";
import { getEnv } from "@/lib/env";

/**
 * Server Actions for groups, participants and invitations.
 *
 * Each one validates its input, resolves an authorized actor, then calls a
 * domain service. No business logic lives here.
 */

export interface CreatedGroupResult {
  readonly groupId: string;
  /** Shown by the screen that replaces the create sheet. */
  readonly invite: { readonly url: string; readonly expiresAt: string | null };
}

export async function createGroupAction(
  formData: FormData,
): Promise<ActionResult<CreatedGroupResult>> {
  const user = await getCurrentUser();
  if (!user) {
    return actionError("Sign in to create a group.");
  }

  const parsed = createGroupSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    icon: formData.get("icon") ?? "",
    iconColor: formData.get("iconColor") ?? "",
    currencyMode: formData.get("currencyMode"),
    baseCurrency: formData.get("baseCurrency") || undefined,
    timezone: formData.get("timezone"),
    ownerDisplayName: formData.get("ownerDisplayName") || user.name,
    // One field repeated per person, so the form still submits without
    // JavaScript. Blank entries are dropped rather than rejected.
    participantNames: formData
      .getAll("participantNames")
      .map((value) => String(value))
      .filter((value) => value.trim() !== ""),
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const result = await runAction("groups.create", async () => {
    const created = await createGroup(user, parsed.data);
    return {
      groupId: created.id,
      invite: {
        url: created.invite.url,
        expiresAt: created.invite.expiresAt?.toISOString() ?? null,
      },
    };
  });

  if (result.ok) {
    revalidatePath("/dashboard");
  }
  return result;
}

export async function updateGroupAction(
  groupId: string,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = updateGroupSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    // The settings form owns the icon now, and always says what it should be.
    // A caller that stays silent still leaves whatever is stored alone —
    // `updateGroup` reads absent and empty as different things.
    icon: formData.get("icon") ?? undefined,
    iconColor: formData.get("iconColor") ?? undefined,
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const result = await runAction("groups.update", async () => {
    const access = await requireGroupAccess(groupId);
    await updateGroup(access, parsed.data);
  });

  if (result.ok) {
    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/groups/${groupId}/settings`);
  }
  return result;
}

/**
 * Remember — or forget — how this group splits things.
 *
 * Written from the split sheet rather than from settings, because that is
 * where the split it describes has just been built and where "always split
 * like this" makes sense as a question. Null clears it.
 *
 * It is a suggestion the next entry seeds from, so any member may set it: the
 * permission that matters is being in the group, which `requireGroupAccess`
 * already establishes.
 */
export async function setGroupSplitDefaultAction(
  groupId: string,
  split: unknown,
): Promise<ActionResult> {
  const parsed = groupSplitDefaultSchema.safeParse(split);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the split.");
  }

  const result = await runAction("groups.setSplitDefault", async () => {
    const access = await requireGroupAccess(groupId);
    await setGroupSplitDefault(access, parsed.data);
  });

  if (result.ok) revalidatePath(`/groups/${groupId}`);
  return result;
}

export async function setGroupArchivedAction(
  groupId: string,
  archived: boolean,
): Promise<ActionResult> {
  const result = await runAction("groups.archive", async () => {
    const access = await requireGroupAccess(groupId);
    await setGroupArchived(access, archived);
  });

  if (result.ok) {
    revalidatePath("/dashboard");
    revalidatePath(`/groups/${groupId}`);
  }
  return result;
}

export async function deleteGroupAction(
  groupId: string,
): Promise<ActionResult> {
  const result = await runAction("groups.delete", async () => {
    const access = await requireGroupAccess(groupId);
    await deleteGroup(access);
  });

  if (!result.ok) return result;
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function addParticipantAction(
  groupId: string,
  formData: FormData,
): Promise<ActionResult<{ participantId: string }>> {
  const parsed = addParticipantSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email") ?? "",
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  // The new id is returned because "add them and create their link" is one
  // gesture on the People screen: the caller needs someone to issue it for.
  const result = await runAction("participants.add", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    const participantId = await addParticipant(access, parsed.data);
    return { participantId };
  });

  if (result.ok) {
    revalidatePath(`/groups/${groupId}/members`);
    revalidatePath(`/groups/${groupId}`);
  }
  return result;
}

export async function updateParticipantAction(
  groupId: string,
  participantId: string,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = addParticipantSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email") ?? "",
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const result = await runAction("participants.update", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await updateParticipant(access, participantId, parsed.data);
  });

  if (result.ok) {
    revalidatePath(`/groups/${groupId}/members`);
  }
  return result;
}

export async function removeParticipantAction(
  groupId: string,
  participantId: string,
): Promise<ActionResult> {
  const result = await runAction("participants.remove", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await removeParticipant(access, participantId);
  });

  if (result.ok) {
    revalidatePath(`/groups/${groupId}/members`);
    revalidatePath(`/groups/${groupId}`);
  }
  return result;
}

/** Undo for the removal above, offered on the toast for a few seconds. */
export async function restoreParticipantAction(
  groupId: string,
  participantId: string,
): Promise<ActionResult> {
  const result = await runAction("participants.restore", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await restoreParticipant(access, participantId);
  });

  if (result.ok) {
    revalidatePath(`/groups/${groupId}/members`);
    revalidatePath(`/groups/${groupId}`);
  }
  return result;
}

export interface InvitationLinkResult {
  /** Full URL, shown once. The server keeps only a hash of the token. */
  readonly url: string;
  readonly expiresAt: string | null;
}

export async function createInvitationAction(
  groupId: string,
  formData: FormData,
): Promise<ActionResult<InvitationLinkResult>> {
  const expiresRaw = formData.get("expiresInDays");
  const parsed = createInvitationSchema.safeParse({
    participantId: formData.get("participantId"),
    expiresInDays:
      expiresRaw && expiresRaw !== "never" ? expiresRaw : undefined,
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const result = await runAction("invitations.create", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    const invitation = await createInvitation(access, parsed.data);
    const env = getEnv();
    return {
      url: `${env.appOrigin}/join/${invitation.token}`,
      expiresAt: invitation.expiresAt?.toISOString() ?? null,
    };
  });

  if (result.ok) {
    revalidatePath(`/groups/${groupId}/members`);
  }
  return result;
}

export async function revokeInvitationAction(
  groupId: string,
  participantId: string,
): Promise<ActionResult> {
  const result = await runAction("invitations.revoke", async () => {
    const access = await requireGroupAccess(groupId);
    await revokeInvitation(access, participantId);
  });

  if (result.ok) {
    revalidatePath(`/groups/${groupId}/members`);
  }
  return result;
}
