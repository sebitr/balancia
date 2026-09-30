"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  actionError,
  requireGroupAccess,
  runAction,
  type ActionResult,
} from "@/lib/actions";
import { MAX_MAPPED_NAMES } from "./limits";
import {
  CREATE_PARTICIPANT,
  commitImportRun,
  mappingMismatch,
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

/**
 * What a commit request may carry, checked before anything is looked up: a run
 * ID, and source names each paired with a participant ID or the create
 * sentinel, no more of them than any file stages. Whether every name is one
 * the run staged and every ID a person in this group only the database can
 * say — `saveParticipantMapping` asks it.
 */
const commitInputSchema = z.object({
  importRunId: z.uuid(),
  mapping: z
    .record(
      z.string().min(1),
      z.union([z.uuid(), z.literal(CREATE_PARTICIPANT)]),
    )
    .refine((value) => Object.keys(value).length <= MAX_MAPPED_NAMES),
});

export async function commitImportAction(
  groupId: string,
  importRunId: string,
  mapping: Record<string, string>,
): Promise<ActionResult<ImportReport>> {
  const result = await runAction("imports.commit", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    const input = commitInputSchema.safeParse({ importRunId, mapping });
    if (!input.success) throw mappingMismatch();
    await saveParticipantMapping(
      access,
      input.data.importRunId,
      input.data.mapping,
    );
    return commitImportRun(input.data.importRunId, access.groupId);
  });

  if (result.ok) {
    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/groups/${groupId}/expenses`);
    revalidatePath(`/groups/${groupId}/settle`);
    revalidatePath(`/groups/${groupId}/import`);
  }
  return result;
}
