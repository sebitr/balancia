"use server";

import { revalidatePath } from "next/cache";
import {
  actionError,
  requireGroupAccess,
  runAction,
  type ActionResult,
} from "@/lib/actions";
import {
  commitImportRun,
  saveParticipantMapping,
  stageImport,
  type ImportPreview,
  type ImportReport,
} from "./service";

/**
 * Import Server Actions.
 *
 * Staging and committing are separate calls on purpose: the user sees a preview
 * and decides the participant mapping between them.
 */

export async function stageImportAction(
  groupId: string,
  formData: FormData,
): Promise<ActionResult<ImportPreview>> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return actionError("Choose a file to import.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  return runAction("imports.stage", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    return stageImport(access, { name: file.name, bytes });
  });
}

export async function commitImportAction(
  groupId: string,
  importRunId: string,
  mapping: Record<string, string>,
): Promise<ActionResult<ImportReport>> {
  const result = await runAction("imports.commit", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await saveParticipantMapping(access, importRunId, mapping);
    return commitImportRun(importRunId, access.groupId);
  });

  if (result.ok) {
    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/groups/${groupId}/expenses`);
    revalidatePath(`/groups/${groupId}/balances`);
    revalidatePath(`/groups/${groupId}/import`);
  }
  return result;
}
