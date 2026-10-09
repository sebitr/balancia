"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, CircleAlert } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { createRecoveryKey, parseRecipient } from "@/modules/backup/age";
import { saveRecoveryKeyAction } from "@/modules/backup/actions";
import { CheckField, FieldError, StepFooter, TextField } from "./fields";
import {
  CONFIRM_LENGTH,
  RecoveryKeyBlock,
  splitIdentity,
} from "./recovery-key-block";

interface MadeKey {
  readonly identity: string;
  readonly recipient: string;
}

/**
 * Step 1: the key that opens every backup, made here and shown once.
 *
 * The private half is made by the browser, lives in this component's state and
 * nowhere else, and is gone when the step is. Only the public half — the
 * `age1…` line — is sent, when Continue is pressed: the OAuth trip in step 3
 * leaves the page, and the server needs the public half by the time it comes
 * back.
 *
 * Continue stays off until two things are true: the box is ticked, and the
 * last six characters have been typed back from what was saved. The first is a
 * promise; the second is the proof the key was actually copied somewhere that
 * can be read again, which is the only way this feature fails for good.
 *
 * Somebody who would rather not trust a key made by JavaScript this server
 * serves can paste a public key of their own, made with `age-keygen`. Nothing
 * of the private half passes through here then at all.
 */
export function KeyStep({
  rotate,
  onSaved,
  onCancel,
}: {
  /** A new key for an existing setup, rather than the first step of one. */
  rotate: boolean;
  /** The public half is stored; carry on. */
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("cloudBackup");
  const confirmId = useId();
  const noteId = `${confirmId}-note`;

  const [made, setMade] = useState<MadeKey | null>(null);
  const [makeFailed, setMakeFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [typed, setTyped] = useState("");
  const [own, setOwn] = useState(false);
  const [ownValue, setOwnValue] = useState("");
  const [ownInvalid, setOwnInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // React runs an effect twice in development to prove it can be undone. A key
  // is not something that is made twice, so the second run finds this set.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    createRecoveryKey().then(setMade, () => setMakeFailed(true));
  }, []);

  const expected = made
    ? splitIdentity(made.identity).tail.toUpperCase()
    : null;
  // Case and spacing are not part of what was saved: a key written down in
  // groups, or copied from a password manager's lowercase view, still matches.
  const normalised = typed.replace(/\s+/g, "").toUpperCase();
  const matches = expected !== null && normalised === expected;
  const mismatch = normalised.length >= CONFIRM_LENGTH && !matches;
  const ready = made !== null && saved && matches;

  const save = async (recipient: string) => {
    setSaving(true);
    setSaveFailed(false);
    try {
      const result = await saveRecoveryKeyAction(recipient);
      if (result.ok && result.data?.ok) {
        onSaved();
        return;
      }
    } catch {
      // Falls through to the same sentence as a refusal.
    }
    setSaveFailed(true);
    setSaving(false);
  };

  const useOwnKey = async () => {
    setSaving(true);
    // Answers null for anything that is not a public key — a private one
    // pasted by mistake included, which is refused here and goes nowhere.
    const recipient = await parseRecipient(ownValue).catch(() => null);
    if (!recipient) {
      setOwnInvalid(true);
      setSaving(false);
      return;
    }
    await save(recipient);
  };

  const failure = saveFailed && (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>{t("key.saveFailed")}</AlertDescription>
    </Alert>
  );

  if (own) {
    return (
      <>
        <SettingsCard title={t("key.ownTitle")} description={t("key.ownBody")}>
          <div className="space-y-3">
            <TextField
              label={t("key.ownLabel")}
              value={ownValue}
              onChange={(value) => {
                setOwnValue(value);
                setOwnInvalid(false);
              }}
              placeholder="age1…"
              error={ownInvalid ? t("key.ownInvalid") : undefined}
              disabled={saving}
              className="font-mono"
            />
            <button
              type="button"
              onClick={() => setOwn(false)}
              className="tap-target text-xs font-medium text-primary-ink underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {t("key.makeOwn")}
            </button>
          </div>
        </SettingsCard>
        {failure}
        <StepFooter
          secondary={{ label: t("setup.cancel"), onClick: onCancel }}
          primary={{
            label: t("key.ownUse"),
            onClick: useOwnKey,
            disabled: ownValue.trim() === "",
            pending: saving,
          }}
        />
      </>
    );
  }

  return (
    <>
      <SettingsCard
        title={rotate ? t("rotate.cardTitle") : t("key.title")}
        description={rotate ? t("rotate.newIntro") : t("key.intro")}
      >
        <div className="space-y-3.5">
          {makeFailed ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{t("error.unknown")}</AlertDescription>
            </Alert>
          ) : made ? (
            <RecoveryKeyBlock
              identity={made.identity}
              recipient={made.recipient}
            />
          ) : (
            <div
              aria-busy="true"
              className="h-32 animate-pulse rounded-xl bg-wash-2"
            />
          )}

          {/* The one warning in the flow, said where the key is in the hand. */}
          <div className="flex items-start gap-2.5 rounded-xl border border-border p-3.5">
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-foreground"
            />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold">{t("key.lostTitle")}</p>
              <p className="text-xs text-pretty text-muted-foreground">
                {t("key.lost")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOwn(true)}
            className="tap-target text-xs font-medium text-primary-ink underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t("key.ownLink")}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title={t("key.checkTitle")}>
        <div className="space-y-3">
          <CheckField
            label={t("key.saved")}
            checked={saved}
            onChange={setSaved}
          />
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="block text-xs font-semibold">
              {t("key.confirmLabel")}
            </label>
            <Input
              id={confirmId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={mismatch || undefined}
              aria-describedby={noteId}
              className="h-10 rounded-xl font-mono tracking-widest uppercase"
            />
            <div id={noteId} aria-live="polite">
              {mismatch ? (
                <FieldError>{t("key.confirmMismatch")}</FieldError>
              ) : matches ? (
                <p className="flex items-center gap-1.5 text-xs text-foreground">
                  <Check aria-hidden="true" className="size-3.5 shrink-0" />
                  {t("key.confirmMatch")}
                </p>
              ) : (
                <p className="text-xs text-pretty text-muted-foreground">
                  {t("key.confirmHelp")}
                </p>
              )}
            </div>
          </div>
        </div>
      </SettingsCard>

      {failure}
      <StepFooter
        secondary={{ label: t("setup.cancel"), onClick: onCancel }}
        primary={{
          label: t("setup.continue"),
          onClick: () => made && save(made.recipient),
          disabled: !ready,
          pending: saving,
        }}
        hint={ready ? undefined : t("key.todo")}
        note={t("key.leave")}
      />
    </>
  );
}
