"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  describedBy,
  useRefusalFocus,
} from "@/components/auth/use-refusal-focus";
import type { SolvedProofOfWork } from "@/components/auth/use-proof-of-work";
import { registerAction } from "@/modules/auth/actions";
import {
  containsIdentity,
  isCommonPassword,
} from "@/modules/auth/common-passwords";
import { Headline, PRIMARY, SECONDARY, Spacer, Sub } from "./screens";

/** The refusal's id, which the field the caret goes back to is described by. */
const ERROR_ID = "onboarding-password-error";
const HINT_ID = "onboarding-password-hint";
const RULE_ID = "onboarding-password-rule";

/**
 * The server's bounds, restated: `MIN_PASSWORD_LENGTH` and
 * `MAX_PASSWORD_LENGTH` live beside the hashing in `passwords.ts`, which
 * imports `node:crypto` and so cannot travel to the browser.
 */
const MIN_LENGTH = 10;
const MAX_LENGTH = 512;

type Rule =
  "passwordMin" | "passwordMax" | "passwordCommon" | "passwordPersonal";

/**
 * Signing up with a password, as the Account step rather than a page of its own.
 *
 * Only offered where neither of the other two can be: an instance with no mail
 * server sends no code, so the password stands in for it — a quiet tap under
 * the passkey on a browser that has one, and the whole of this step on a
 * browser that does not. It used to be `/register/password`, a different page
 * with its own header and its own column, which dropped the reader out of the
 * flow they were in: no progress bar, no back button to where they had been,
 * and on a group link no way back to the group at all.
 *
 * One password field, with an eye on it, and no confirm field. The eye is what
 * a confirm field was for — catching a typo — without typing it twice blind.
 *
 * The server action is the same one the old page called, with the same proof
 * of work and the same rate limits. The password rules are checked here first,
 * from the same list the server checks, so the two refusals people actually
 * meet arrive under the field, before the round trip, rather than as a banner
 * after it. What the server can still refuse — the address taken, too many
 * attempts, registration closed — sends the caret to the address.
 *
 * The name is asked for here only when the flow does not know one yet, which
 * is the cold arrival: the account cannot be created without one, and
 * inventing a placeholder is what `users.name_chosen_at` exists to rule out. On
 * a link the group already has a name for this person, and it is used as is.
 */
export function PasswordSignup({
  askName,
  name,
  onNameChange,
  email,
  onEmailChange,
  explainer,
  solution,
  onUsePasskey,
  onDone,
}: {
  /** The flow knows no name yet, so this step asks for one. */
  askName: boolean;
  name: string;
  onNameChange: (name: string) => void;
  email: string;
  onEmailChange: (email: string) => void;
  /** Why this is the only way in, when it is. */
  explainer: string | null;
  solution: () => Promise<SolvedProofOfWork | null>;
  /** Back to the passkey, where the browser can hold one. */
  onUsePasskey: (() => void) | null;
  onDone: (outcome: { claimedGroupId: string | null }) => void;
}) {
  const t = useTranslations("onboarding.identity");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  /** What the server said no to. */
  const [error, setError] = useState<string | null>(null);
  /** Which of the password rules this attempt broke, said under the field. */
  const [rule, setRule] = useState<Rule | null>(null);

  const emailField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const [refused, refuse] = useRefusalFocus<"email" | "password">((field) => {
    const target = field === "email" ? emailField : passwordField;
    target.current?.focus();
    target.current?.select();
  });

  const address = email.trim();
  const typedName = name.trim();
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address);
  const ready =
    !busy && valid && password.length > 0 && (!askName || typedName !== "");

  const ruleBroken = (): Rule | null => {
    if (password.length < MIN_LENGTH) return "passwordMin";
    if (password.length > MAX_LENGTH) return "passwordMax";
    if (isCommonPassword(password)) return "passwordCommon";
    if (containsIdentity(password, { email: address, name: typedName })) {
      return "passwordPersonal";
    }
    return null;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setError(null);
    refuse(null);

    const broken = ruleBroken();
    setRule(broken);
    if (broken) {
      refuse("password");
      return;
    }

    setBusy(true);
    const result = await registerAction({
      name: typedName,
      email: address,
      password,
      proofOfWork: await solution(),
    });
    setBusy(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? t("createFailed"));
      refuse("email");
      return;
    }
    if (result.data.verificationRequired) {
      /*
       * Not reachable as the pages are wired: this step is only offered where
       * the instance has no mail server, and only an instance with one asks
       * for the address to be confirmed. Said rather than assumed, so that an
       * instance reconfigured between the page and the tap does not land
       * somebody on a profile screen with no session behind it.
       */
      setError(t("checkEmail", { email: address }));
      return;
    }
    onDone({ claimedGroupId: result.data.claimedGroupId });
  };

  return (
    <form
      className="flex flex-1 flex-col gap-5"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <div className="flex flex-col gap-2">
        <Headline>{t("passwordTitle")}</Headline>
        <Sub>{t("passwordSub")}</Sub>
      </div>

      <div className="flex flex-col gap-3">
        {askName && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="onboarding-password-name">{t("nameLabel")}</Label>
            <Input
              id="onboarding-password-name"
              className="h-14 rounded-xl"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              autoComplete="name"
              autoFocus
              maxLength={120}
              disabled={busy}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="onboarding-email">{t("emailLabel")}</Label>
          <Input
            ref={emailField}
            id="onboarding-email"
            type="email"
            className="h-14 rounded-xl"
            aria-describedby={describedBy(
              error && refused === "email" && ERROR_ID,
            )}
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder={t("emailPlaceholder")}
            // The address is the account's name to a password manager, which
            // is what lets it save the pair and offer both on the way back.
            autoComplete="username"
            inputMode="email"
            autoFocus={!askName && address === ""}
            disabled={busy}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="onboarding-password">{t("passwordLabel")}</Label>
          <PasswordInput
            ref={passwordField}
            id="onboarding-password"
            className="h-14 rounded-xl"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              // The rule was about the last attempt; this is a new one.
              if (rule) setRule(null);
            }}
            autoComplete="new-password"
            autoFocus={!askName && address !== ""}
            aria-invalid={rule !== null}
            // The rule, then what is wrong with this attempt at it: a screen
            // reader returning to the field hears both, as the eye sees both.
            aria-describedby={describedBy(HINT_ID, rule && RULE_ID)}
            disabled={busy}
          />
          <p id={HINT_ID} className="text-xs text-muted-foreground">
            {t("passwordHint")}
          </p>
          {rule && (
            <p id={RULE_ID} className="text-sm text-destructive">
              {t(rule)}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {explainer && (
        <p className="text-sm text-pretty text-muted-foreground">{explainer}</p>
      )}

      <Spacer />

      <div className="flex flex-col gap-2.5">
        <Button type="submit" size="lg" className={PRIMARY} disabled={!ready}>
          {busy && (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          )}
          {t("createAccount")}
        </Button>
        {onUsePasskey && (
          <Button
            type="button"
            size="lg"
            variant="ghost"
            className={SECONDARY}
            disabled={busy}
            onClick={onUsePasskey}
          >
            {t("usePasskeyInstead")}
          </Button>
        )}
      </div>
    </form>
  );
}
