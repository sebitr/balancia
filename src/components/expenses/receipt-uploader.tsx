"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Receipt upload.
 *
 * Uploads immediately to /api/groups/[groupId]/attachments and keeps the
 * returned IDs, which the expense form submits so the attachment is linked in
 * the same transaction as the expense. Anything left unlinked is swept by the
 * worker.
 */

interface UploadedFile {
  readonly id: string;
  readonly name: string;
}

export function ReceiptUploader({
  groupId,
  onUploaded,
}: {
  groupId: string;
  onUploaded: (attachmentId: string) => void;
}) {
  const t = useTranslations("receipts");
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setPending(true);

    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/groups/${groupId}/attachments`, {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as
        { id: string; fileName: string } | { error: string };

      if (!response.ok || "error" in payload) {
        setError("error" in payload ? payload.error : t("uploadFailed"));
        return;
      }

      setUploaded((current) => [
        ...current,
        { id: payload.id, name: payload.fileName },
      ]);
      onUploaded(payload.id);
    } catch {
      setError(t("connectionFailed"));
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf"
        className="sr-only"
        id="receipt-input"
        onChange={onSelect}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <Upload aria-hidden="true" />
        )}
        {t("attach")}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {uploaded.length > 0 && (
        <ul className="space-y-1">
          {uploaded.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Check aria-hidden="true" className="size-4 text-positive" />
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                onClick={() =>
                  setUploaded((current) =>
                    current.filter((entry) => entry.id !== file.id),
                  )
                }
                className="ml-auto hover:text-foreground"
                aria-label={t("removeFile", { name: file.name })}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">{t("formats")}</p>
    </div>
  );
}
