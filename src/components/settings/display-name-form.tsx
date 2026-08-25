"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { toastUndoable } from "@/components/ui/sonner";
import { useAutosave } from "@/components/ui/use-autosave";
import { setDisplayNameAction } from "@/modules/profile/actions";

/**
 * The name on the account, written as it is typed.
 *
 * `useAutosave` with the default `"typed"` timing: the write waits for a pause
 * rather than chasing every keystroke, and a run of edits is one thing to
 * undo — so somebody who retypes their whole name and thinks better of it gets
 * back the name they started with, not the last letter they deleted.
 *
 * An empty field is not written. The server refuses it too, but refusing it
 * here is what keeps the reader from watching an error toast appear because
 * they selected all and pressed backspace on the way to typing something else.
 */
export function DisplayNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const t = useTranslations("userSettings");
  const tCommon = useTranslations("common");
  const fieldId = useId();

  const { draft, edit, flush } = useAutosave({
    initial: { name: initialName },
    same: (a, b) => a.name.trim() === b.name.trim(),
    ready: (value) => value.name.trim().length > 0,
    write: async (value) => {
      const result = await setDisplayNameAction(value.name);
      if (!result.ok) {
        toast.error(result.error ?? t("nameFailed"));
        return false;
      }
      return true;
    },
    announce: (undo) => {
      toastUndoable(
        t("nameSaved"),
        { label: tCommon("undo"), onUndo: undo },
        { id: "display-name" },
      );
    },
    // The hub's identity card and the dashboard greeting are both this name.
    settled: () => router.refresh(),
  });

  return (
    <div className="space-y-2">
      <label htmlFor={fieldId} className="block text-xs font-semibold">
        {t("displayName")}
      </label>
      <Input
        id={fieldId}
        value={draft.name}
        maxLength={120}
        autoComplete="name"
        onChange={(event) => edit({ name: event.target.value })}
        // Leaving the field is a decision too: whatever is pending goes now
        // rather than waiting out the pause the reader has already ended.
        onBlur={flush}
        className="h-10 rounded-xl"
      />
      <p className="text-xs text-muted-foreground">{t("displayNameHelp")}</p>
    </div>
  );
}
