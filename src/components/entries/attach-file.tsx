"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Paperclip, X } from "lucide-react";
import { uploadReceipt } from "@/components/expenses/upload-receipt";
import { cn } from "@/lib/utils";
import { ROW, Row, RowCard } from "./row-card";

/**
 * Putting a file on the entry.
 *
 * This replaces a link that said "Note, category or attachment" and opened the
 * category sheet — three promises, one of them kept, and the kept one already
 * had its own chip two rows above. One button that does one nameable thing is
 * worth more than a menu of maybes on a screen this short.
 *
 * It is a row in a card like the date and Repeats, not a line of text under
 * them: it was the one control on the sheet that was not, drawn 22px tall with
 * nothing around it to hit, at the very bottom of the form where a thumb
 * lands last. The files it has attached are rows of the same card.
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
  unavailable = null,
}: {
  groupId: string;
  files: readonly EntryAttachment[];
  onAttached: (file: EntryAttachment) => void;
  onRemove: (id: string) => void;
  /**
   * Why nothing can be attached right now, or null when it can.
   *
   * The row stays on the sheet, disabled, and says this under its name. A
   * repeating entry is the case: its template has nowhere to keep a file, and
   * the row used to stay live while the save quietly left the file behind.
   * Files already attached stay listed, so turning Repeats back off finds
   * them where they were.
   */
  unavailable?: string | null;
}) {
  const t = useTranslations("addEntry.attach");
  const tReceipts = useTranslations("receipts");
  const reasonId = useId();

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

  const Glyph = pending ? Loader2 : Paperclip;

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

      <RowCard>
        <button
          type="button"
          disabled={pending || unavailable !== null}
          onClick={() => inputRef.current?.click()}
          // The reason is under the name rather than part of it: "Attach a
          // file" is what the control is, and why it is off is a second fact.
          aria-label={pending ? t("uploading") : t("add")}
          aria-describedby={unavailable !== null ? reasonId : undefined}
          className={cn(
            ROW,
            "py-2 text-left transition-colors focus-visible:bg-accent focus-visible:outline-none active:bg-accent disabled:active:bg-transparent",
          )}
        >
          <Glyph
            aria-hidden="true"
            className={cn(
              "size-[18px] shrink-0 text-muted-foreground",
              pending && "animate-spin",
            )}
          />
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-sm text-muted-foreground",
                // Dimmed as a control that cannot be pressed; the reason
                // below it is not, so it can still be read.
                unavailable !== null && "opacity-50",
              )}
            >
              {pending ? t("uploading") : t("add")}
            </span>
            {unavailable !== null && (
              <span
                id={reasonId}
                className="block text-xs text-muted-foreground"
              >
                {unavailable}
              </span>
            )}
          </span>
        </button>

        {files.map((file) => (
          <Row key={file.id}>
            <Check
              aria-hidden="true"
              className="size-[18px] shrink-0 text-positive-ink"
            />
            <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
            <button
              type="button"
              onClick={() => onRemove(file.id)}
              aria-label={t("remove", { name: file.name })}
              className="tap-target grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-wash-3"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </Row>
        ))}
      </RowCard>

      {error && <p className="text-xs text-destructive-ink">{error}</p>}
    </div>
  );
}
