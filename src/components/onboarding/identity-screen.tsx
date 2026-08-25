"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fingerprint, Loader2 } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePasskeySupport } from "@/components/auth/use-passkey-support";
import { signInWithPasskey } from "@/modules/auth/passkey-client";
import {
  requestSignInCodeAction,
  signInWithCodeAction,
  startCodeSignupAction,
  verifySignupCodeAction,
} from "@/modules/auth/actions";
import { CODE_LENGTH } from "@/modules/auth/code-format";
import { CodeInput } from "./code-input";
import { Headline, PRIMARY, SECONDARY, Spacer, Sub } from "./screens";
import type { Intent } from "./route";

/**
 * Proving who this is, with nothing to invent and nothing to retype.
 *
 * A passkey is the first offer wherever the browser has one, because it is the
 * only credential here that cannot be phished, forgotten or typed into the
 * wrong site — and because it takes one tap. What it needs from this screen is
 * an address, which the account has to carry anyway.
 *
 * The code is the fallback, and it is a real one rather than a consolation:
 * six digits mailed to the address, typed back into the boxes below, and the
 * account is both created and confirmed by the time this screen is done. That
 * replaces the old arrangement, where registering sent a link and left the
 * reader on a "check your email" page in a flow they never came back to.
 *
 * Which of the two runs is a matter of what the browser and the instance can
 * do, never of what the reader is told to prefer: an instance with no mail
 * server is not offered a code, and a browser with no WebAuthn is not offered
 * a passkey. If neither is available the password pages are still there, and
 * this screen says so rather than pretending.
 */
export function IdentityScreen({
  intent,
  name,
  email,
  onEmailChange,
  codeSignupAvailable,
  join,
  onDone,
}: {
  intent: Intent;
  /** The name the account will carry, when the flow already knows it. */
  name: string;
  email: string;
  onEmailChange: (email: string) => void;
  codeSignupAvailable: boolean;
  /** Set on a shared link: which listed member is being claimed, if any. */
  join?: { participantId: string | null; displayName: string };
  onDone: (outcome: {
    credential: "passkey" | "code";
    joinedGroupId: string | null;
    claimedGroupId: string | null;
  }) => void;
}) {
  const t = useTranslations("onboarding.identity");
  const passkeys = usePasskeySupport();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once a code has been asked for, which is what reveals the boxes. */
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");

  const signingIn = intent === "signin";
  const address = email.trim();
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address);

  /**
   * The name an account is created with, before its own screen has been seen.
   *
   * On a personal invitation the name is asked for *after* the address, so at
   * this point there may be none. The address's local part stands in — it is
   * what the authenticator will show in its prompt, and the profile screen
   * that follows overwrites it a few seconds later.
   */
  const provisionalName = name.trim() || address.split("@")[0] || address;

  const fail = (message: string) => {
    setError(message);
    setBusy(false);
  };

  const withPasskey = async () => {
    setError(null);
    setBusy(true);
    try {
      if (signingIn) {
        await signInWithPasskey();
        // A discoverable credential says who this is on its own, so there is
        // no address to have typed and no group work to report.
        onDone({
          credential: "passkey",
          joinedGroupId: null,
          claimedGroupId: null,
        });
        return;
      }

      const optionsResponse = await fetch("/api/auth/passkey/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: provisionalName, email: address }),
      });
      if (!optionsResponse.ok) {
        fail(await readError(optionsResponse, t("passkeyFailed")));
        return;
      }

      // Throws if the reader cancels or the authenticator refuses, which is a
      // decision rather than a failure — hence the quiet return below.
      const attestation = await startRegistration({
        optionsJSON: await optionsResponse.json(),
      });

      const finished = await fetch("/api/auth/passkey/signup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, join }),
      });
      if (!finished.ok) {
        fail(await readError(finished, t("passkeyFailed")));
        return;
      }

      const settled = (await finished.json()) as {
        joinedGroupId: string | null;
        claimedGroupId: string | null;
      };
      onDone({ credential: "passkey", ...settled });
    } catch (thrown) {
      // `NotAllowedError` is the reader dismissing the sheet. Nothing has gone
      // wrong and nothing needs saying; the screen is still here.
      if (thrown instanceof Error && thrown.name === "NotAllowedError") {
        setBusy(false);
        return;
      }
      fail(thrown instanceof Error ? thrown.message : t("passkeyFailed"));
    }
  };

  const askForCode = async () => {
    setError(null);
    setBusy(true);
    const result = signingIn
      ? await requestSignInCodeAction({ email: address })
      : await startCodeSignupAction({ name: provisionalName, email: address });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("codeFailed"));
      return;
    }
    setSent(true);
  };

  const submitCode = async (value: string) => {
    setError(null);
    setBusy(true);
    const input = { email: address, code: value, join };
    const result = signingIn
      ? await signInWithCodeAction(input)
      : await verifySignupCodeAction(input);
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? t("codeWrong"));
      setCode("");
      return;
    }
    onDone({
      credential: "code",
      joinedGroupId: result.data.joinedGroupId,
      claimedGroupId: result.data.claimedGroupId,
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Headline>{signingIn ? t("signInTitle") : t("title")}</Headline>
        <Sub>{sent ? t("sentSub", { email: address }) : t("sub")}</Sub>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="sr-only" htmlFor="onboarding-email">
          {t("emailLabel")}
        </Label>
        <Input
          id="onboarding-email"
          type="email"
          className="h-14 rounded-xl"
          value={email}
          onChange={(event) => {
            onEmailChange(event.target.value);
            // Changing the address invalidates the code that was sent to the
            // old one, so the boxes go away rather than silently failing.
            if (sent) {
              setSent(false);
              setCode("");
            }
          }}
          placeholder={t("emailPlaceholder")}
          autoComplete="email"
          inputMode="email"
          autoFocus={!sent}
          disabled={busy}
        />

        {sent && (
          <div className="flex flex-col gap-2 pt-1">
            <CodeInput
              value={code}
              onChange={setCode}
              onComplete={(value) => void submitCode(value)}
              label={t("codeLabel")}
              disabled={busy}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">{t("codeHint")}</p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Spacer />

      <div className="flex flex-col gap-2.5">
        {sent ? (
          <>
            <Button
              size="lg"
              className={PRIMARY}
              disabled={busy || code.length < CODE_LENGTH}
              onClick={() => void submitCode(code)}
            >
              {busy && (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              )}
              {t("verify")}
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className={SECONDARY}
              disabled={busy}
              onClick={() => void askForCode()}
            >
              {t("resend")}
            </Button>
          </>
        ) : (
          <>
            {passkeys && (
              <Button
                size="lg"
                className={PRIMARY}
                disabled={busy || (!signingIn && !valid)}
                onClick={() => void withPasskey()}
              >
                {busy ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Fingerprint aria-hidden="true" className="size-4" />
                )}
                {signingIn ? t("signInWithPasskey") : t("withPasskey")}
              </Button>
            )}

            {codeSignupAvailable && (
              <Button
                size="lg"
                variant={passkeys ? "outline" : "default"}
                className={passkeys ? SECONDARY : PRIMARY}
                disabled={busy || !valid}
                onClick={() => void askForCode()}
              >
                {busy && !passkeys && (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                )}
                {passkeys ? t("orCode") : t("emailMeACode")}
              </Button>
            )}

            {/*
              Neither a passkey nor a code: an instance with no mail server,
              read in a browser with no WebAuthn. The password pages still
              work, and saying so is better than a screen with one dead button.
            */}
            {!passkeys && !codeSignupAvailable && (
              <>
                <p className="text-sm text-pretty text-muted-foreground">
                  {t("noCredentialRoute")}
                </p>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className={SECONDARY}
                >
                  <Link href={signingIn ? "/sign-in" : "/register/password"}>
                    {signingIn ? t("usePassword") : t("usePasswordSignUp")}
                  </Link>
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

async function readError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}
