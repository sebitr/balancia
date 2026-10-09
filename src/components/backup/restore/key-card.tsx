"use client";

import { useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert, FileKey, Lock } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

/**
 * What is wrong with the key, if anything, and so which sentence goes under
 * the field. Both are about the key and both are cured by another one, but they
 * are different things to be told: a key that does not open this backup was
 * tried, and a key file with no key in it was never a key.
 */
export type KeyProblem = "wrongKey" | "noKeyInFile";

/**
 * Step two of restoring: the recovery key.
 *
 * The key is typed, pasted, or read from the key file that was saved when it
 * was made. Wherever it comes from it ends up in this one controlled field and
 * in the page's memory, and nowhere else: not in a form field with a `name`
 * (so no submit could carry it), not in the address, not in storage, and the
 * browser is asked not to offer to remember it. The sentence under the field
 * says so, and is what the field is described by, so it is the last thing a
 * screen reader says about it.
 */
export function KeyCard({
  value,
  onChange,
  onKeyFile,
  problem,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  /** A file chosen with "Choose a key file". Reading it is the screen's job. */
  onKeyFile: (file: File) => void;
  /** Why the key was refused, or null while nothing is wrong with it. */
  problem: KeyProblem | null;
  disabled: boolean;
}) {
  const t = useTranslations("cloudBackup");
  const invalid = problem !== null;
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const privacyId = `${fieldId}-privacy`;
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <SettingsCard title={t("restore.keyTitle")}>
      <div className="space-y-3.5">
        <div className="space-y-1.5">
          <label htmlFor={fieldId} className="block text-xs font-semibold">
            {t("restore.keyLabel")}
          </label>
          <PasswordInput
            id={fieldId}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t("restore.keyPlaceholder")}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            // Password managers read a masked field as a password, and offer
            // to keep it. This is not one, and keeping it is the opposite of
            // what the screen promises.
            data-1p-ignore
            data-lpignore="true"
            data-bwignore="true"
            aria-invalid={invalid}
            aria-describedby={invalid ? `${errorId} ${privacyId}` : privacyId}
            className="h-10 rounded-xl font-mono"
          />
          {/* Always on the page, so that a message arriving in it is announced
              instead of being added to the page silently. */}
          <div aria-live="polite">
            {problem && (
              <p
                id={errorId}
                className="flex items-start gap-1.5 text-xs text-pretty text-destructive"
              >
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0"
                />
                {t(`restore.${problem}`)}
              </p>
            )}
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          hidden
          aria-label={t("restore.keyFile")}
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = "";
            if (picked) onKeyFile(picked);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        >
          <FileKey aria-hidden="true" />
          {t("restore.keyFile")}
        </Button>

        <p
          id={privacyId}
          className="flex items-start gap-2 text-xs text-pretty text-muted-foreground"
        >
          <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {t("restore.privacy")}
        </p>
      </div>
    </SettingsCard>
  );
}
