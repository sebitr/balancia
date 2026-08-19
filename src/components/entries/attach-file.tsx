"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Paperclip, X } from "lucide-react";
import { uploadReceipt } from "@/components/expenses/upload-receipt";

/**
 * Putting a file on the entry.
 *
 * This replaces a link that said "Note, category or attachment" and opened the
 * category sheet — three promises, one of them kept, and the kept one already
 * had its own chip two rows above. One button that does one nameable thing is
 * worth more than a menu of maybes on a screen this short.
 *
 * The upload happens on choosing the file, not on saving, so a slow connection
 * is paid for while the description is still being typed. The IDs come back
 * here and the form submits them with the entry, which is what links them; an
 * upload whose entry is never saved is left unlinked and swept by the worker.
 */

export interface EntryAttachment {
  readonly id: string;
  readonly name: string;
}

/** Everything the receipt endpoint takes, which is more than images. */
const ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf";

export function AttachFile({
  groupId,
  files,
  onAttached,
  onRemove,
  note = null,
}: {
  groupId: string;
  files: readonly EntryAttachment[];
  onAttached: (file: EntryAttachment) => void;
  onRemove: (id: string) => void;
  /** Said out loud when what is attached will not reach the saved entry. */
  note?: string | null;
}) {
  const t = useTranslations("addEntry.attach");
  const tReceipts = useTranslations("receipts");

  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setPending(true);
    try {
      const result = await uploadReceipt(groupId, file, file.name);
      if (!result.ok) {
        setError(
          result.reason === "offline"
            ? tReceipts("connectionFailed")
            : (result.message ?? tReceipts("uploadFailed")),
        );
        return;
      }
      onAttached({ id: result.file.id, name: result.file.fileName });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(event) => void onSelect(event)}
        aria-hidden="true"
        tabIndex={-1}
      />

      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 self-start text-sm text-muted-foreground disabled:opacity-60"
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Paperclip aria-hidden="true" className="size-4" />
        )}
        {pending ? t("uploading") : t("add")}
      </button>

      {error && <p className="text-xs text-negative">{error}</p>}

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <Check aria-hidden="true" className="size-4 text-positive" />
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => onRemove(file.id)}
                aria-label={t("remove", { name: file.name })}
                className="-m-1 ml-auto shrink-0 rounded-full p-1 transition-colors active:bg-white/10"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {note && files.length > 0 && (
        <p className="text-xs text-muted-foreground">{note}</p>
      )}
    </div>
  );
}
