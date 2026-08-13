/**
 * Uploading a receipt image to this instance.
 *
 * One definition, because two things now attach receipts: the uploader on the
 * expense form, and the scanner, when someone chooses to keep the photo they
 * just scanned. A second implementation would be a second place for the
 * endpoint, the field name or the error handling to drift.
 *
 * This is the only path by which a receipt image reaches the server, and it is
 * always something the user asked for. Scanning does not use it.
 */

export interface UploadedReceipt {
  readonly id: string;
  readonly fileName: string;
}

export type UploadFailure = "rejected" | "offline";

export type UploadResult =
  | { readonly ok: true; readonly file: UploadedReceipt }
  | {
      readonly ok: false;
      readonly reason: UploadFailure;
      readonly message?: string;
    };

export async function uploadReceipt(
  groupId: string,
  file: Blob,
  fileName?: string,
): Promise<UploadResult> {
  const body = new FormData();
  body.append("file", file, fileName);

  try {
    const response = await fetch(`/api/groups/${groupId}/attachments`, {
      method: "POST",
      body,
    });
    const payload = (await response.json()) as
      UploadedReceipt | { error: string };

    if (!response.ok || "error" in payload) {
      return {
        ok: false,
        reason: "rejected",
        message: "error" in payload ? payload.error : undefined,
      };
    }
    return { ok: true, file: payload };
  } catch {
    return { ok: false, reason: "offline" };
  }
}
