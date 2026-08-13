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
  updateGroupSchema,
} from "./schemas";
import {
  addParticipant,
  createGroup,
  createInvitation,
  deleteGroup,
  removeParticipant,
  revokeInvitation,
  setGroupArchived,
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

export async function createGroupAction(
  formData: FormData,
): Promise<ActionResult<{ groupId: string }>> {
  const user = await getCurrentUser();
  if (!user) {
    return actionError("Sign in to create a group.");
  }

  const parsed = createGroupSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
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
    return { groupId: created.id };
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
): Promise<ActionResult> {
  const parsed = addParticipantSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email") ?? "",
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const result = await runAction("participants.add", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await addParticipant(access, parsed.data);
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
