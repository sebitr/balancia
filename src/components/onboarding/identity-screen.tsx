"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fingerprint, Loader2 } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  usePasskeySupport,
  usePlatformAuthenticator,
} from "@/components/auth/use-passkey-support";
import { signInWithPasskey } from "@/modules/auth/passkey-client";
import {
  requestSignInCodeAction,
  signInWithCodeAction,
  startCodeSignupAction,
  verifySignupCodeAction,
} from "@/modules/auth/actions";
import { useProofOfWork } from "@/components/auth/use-proof-of-work";
import {
  describedBy,
  useRefusalFocus,
} from "@/components/auth/use-refusal-focus";
import { CODE_LENGTH } from "@/modules/auth/code-format";
import { CodeInput } from "./code-input";
import { OpenMailButton } from "./open-mail-button";
import { PasswordSignup } from "./password-signup";
import { useResendCooldown } from "./use-resend-cooldown";
import { Headline, PRIMARY, SECONDARY, Spacer, Sub } from "./screens";
import type { Intent } from "./route";

/** The refusal's id, which the field the caret goes back to is described by. */
const ERROR_ID = "onboarding-identity-error";

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
 * a passkey. Where there is no code a password stands in for it, on this same
 * step — see `PasswordSignup` — and where there is neither a code nor a
 * passkey it is the whole of the step, and the step says why.
 */
export function IdentityScreen({
  intent,
  name,
  onNameChange,
  email,
  onEmailChange,
  codeSignupAvailable,
  join,
  onDone,
}: {
  intent: Intent;
  /** The name the account will carry, when the flow already knows it. */
  name: string;
  /** Only the password asks for a name here, and only when there is none. */
  onNameChange: (name: string) => void;
  email: string;
  onEmailChange: (email: string) => void;
  codeSignupAvailable: boolean;
  /** Set on a shared link: which listed member is being claimed, if any. */
  join?: { participantId: string | null; displayName: string };
  onDone: (outcome: {
    credential: "passkey" | "code" | "password";
    joinedGroupId: string | null;
    claimedGroupId: string | null;
  }) => void;
}) {
  const t = useTranslations("onboarding.identity");
  const passkeys = usePasskeySupport();
  /*
   * Whether the flow already had a name when this step opened, decided once.
   *
   * Read live, the password's name field would vanish under the first letter
   * typed into it. The step is remounted every time it is reached, so this is
   * the name the flow arrived with, not one typed here a moment ago.
   */
  const [nameKnown] = useState(() => name.trim() !== "");
  /** The reader asked for the password over the passkey. */
  const [passwordChosen, setPasswordChosen] = useState(false);
  /*
   * Which of the two is the first offer.
   *
   * A passkey is first where this device can hold one — a phone, a laptop with
   * Touch ID or Windows Hello. On a desktop with a WebAuthn API and nothing
   * behind it, the button opens a sheet asking for a phone or a security key,
   * so there the code goes first and the passkey waits underneath. Until the
   * browser has answered, the passkey keeps its place: a phone must never see
   * the order flip.
   */
  const platform = usePlatformAuthenticator();
  const passkeyFirst = passkeys && platform !== false;
  // Solved in the background from the moment this screen appears, so the
  // second of hashing an instance may ask for happens while somebody is still
  // typing their address rather than after they have committed to it.
  const { solution } = useProofOfWork();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once a code has been asked for, which is what reveals the boxes. */
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  // Counts down from the moment a code goes out; the resend button waits on
  // it, so a second tap cannot retire a code that is still in the post.
  const resend = useResendCooldown();

  /*
   * Where a refused address or code sends the caret back to. Both fields are
   * disabled while the request is out, which lets go of focus, so without
   * this a refusal left the keyboard on nothing — and the message, which is
   * not an alert here, unread. Described by the message once focused, it is
   * read out with the field.
   */
  const emailField = useRef<HTMLInputElement>(null);
  const codeField = useRef<HTMLInputElement>(null);
  const [refused, refuse] = useRefusalFocus<"email" | "code">((field) => {
    if (field === "code") {
      codeField.current?.focus();
      return;
    }
    emailField.current?.focus();
    emailField.current?.select();
  });

  const signingIn = intent === "signin";
  const address = email.trim();
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address);

  /**
   * The name the account is created with, or null when there is none yet.
   *
   * On a personal invitation the name is asked for *after* the address, so at
   * this point there may genuinely be none — and null is what says so. The
   * server stands the address's local part in for the authenticator's prompt
   * and leaves the account marked unnamed, which is what lets the profile
   * screen a few seconds later be told apart from never arriving at all.
   * Inventing the placeholder here instead made the two indistinguishable,
   * and the dashboard nagged people whose name was their address's local part
   * for good.
   */
  const typedName = name.trim() || null;

  const fail = (message: string) => {
    setError(message);
    setBusy(false);
  };

  const withPasskey = async () => {
    setError(null);
    refuse(null);
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
        body: JSON.stringify({
          name: typedName,
          email: address,
          proofOfWork: await solution(),
        }),
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
      fail(
        (thrown instanceof Error ? thrown.message : "") || t("passkeyFailed"),
      );
    }
  };

  const askForCode = async () => {
    setError(null);
    refuse(null);
    // A resend: the boxes are on screen and are what is typed into next.
    const resending = sent;
    setBusy(true);
    const result = signingIn
      ? // Signing in is not account creation and asks for no proof: the
        // account already exists, and the address is its own rate limit.
        await requestSignInCodeAction({ email: address })
      : await startCodeSignupAction({
          name: typedName,
          email: address,
          proofOfWork: await solution(),
        });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("codeFailed"));
      refuse(resending ? "code" : "email");
      return;
    }
    setSent(true);
    resend.start();
  };

  const submitCode = async (value: string) => {
    setError(null);
    refuse(null);
    setBusy(true);
    const input = { email: address, code: value, join };
    const result = signingIn
      ? await signInWithCodeAction(input)
      : await verifySignupCodeAction(input);
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? t("codeWrong"));
      setCode("");
      refuse("code");
      return;
    }
    onDone({
      credential: "code",
      joinedGroupId: result.data.joinedGroupId,
      claimedGroupId: result.data.claimedGroupId,
    });
  };

  /*
   * A password, where the instance cannot mail a code: on request beside a
   * passkey, and from the start where the browser cannot hold one either.
   *
   * Signing in is not here. An account that already has a password signs in
   * on `/sign-in`, which also offers what this step cannot — recovering it.
   */
  const usingPassword =
    !signingIn && !codeSignupAvailable && (passwordChosen || !passkeys);
  if (usingPassword) {
    return (
      <PasswordSignup
        askName={!nameKnown}
        name={name}
        onNameChange={onNameChange}
        email={email}
        onEmailChange={onEmailChange}
        explainer={passkeys ? null : t("noCredentialRoute")}
        solution={solution}
        onUsePasskey={passkeys ? () => setPasswordChosen(false) : null}
        onDone={({ claimedGroupId }) =>
          // A password signup carries no join: on a shared link the flow
          // joins as the account it has just signed in, as after a passkey.
          onDone({
            credential: "password",
            joinedGroupId: null,
            claimedGroupId,
          })
        }
      />
    );
  }

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
          ref={emailField}
          id="onboarding-email"
          type="email"
          className="h-14 rounded-xl"
          aria-describedby={describedBy(
            error && refused === "email" && ERROR_ID,
          )}
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
              ref={codeField}
              value={code}
              onChange={setCode}
              onComplete={(value) => void submitCode(value)}
              label={t("codeLabel")}
              disabled={busy}
              autoFocus
              describedBy={describedBy(error && refused === "code" && ERROR_ID)}
            />
            <p className="text-xs text-muted-foreground">{t("codeHint")}</p>
          </div>
        )}
      </div>

      {error && (
        <p id={ERROR_ID} className="text-sm text-destructive">
          {error}
        </p>
      )}

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
            <OpenMailButton />
            <Button
              size="lg"
              variant="ghost"
              className={SECONDARY}
              disabled={busy || resend.remaining > 0}
              onClick={() => void askForCode()}
            >
              {resend.remaining > 0
                ? t("resendIn", { seconds: resend.remaining })
                : t("resend")}
            </Button>
          </>
        ) : (
          <>
            {(() => {
              // The passkey button and the code button, in whichever order
              // this device earns. A code stands alone where there is no
              // WebAuthn; a passkey stands alone where there is no mail.
              const codeFirst = codeSignupAvailable && !passkeyFirst;
              const passkeyButton = passkeys && (
                <div key="passkey" className="flex flex-col gap-1.5">
                  <Button
                    size="lg"
                    variant={codeFirst ? "outline" : "default"}
                    className={codeFirst ? SECONDARY : PRIMARY}
                    disabled={busy || (!signingIn && !valid)}
                    onClick={() => void withPasskey()}
                  >
                    {busy && !codeFirst ? (
                      <Loader2
                        aria-hidden="true"
                        className="size-4 animate-spin"
                      />
                    ) : (
                      <Fingerprint aria-hidden="true" className="size-4" />
                    )}
                    {signingIn ? t("signInWithPasskey") : t("withPasskey")}
                  </Button>
                  {/* The word "passkey" explains nothing on its own; the
                      benefit is what people recognise. */}
                  <p className="text-center text-xs text-pretty text-muted-foreground">
                    {t("passkeyExplainer")}
                  </p>
                </div>
              );
              const codeButton = codeSignupAvailable && (
                <Button
                  key="code"
                  size="lg"
                  variant={codeFirst || !passkeys ? "default" : "outline"}
                  className={codeFirst || !passkeys ? PRIMARY : SECONDARY}
                  disabled={busy || !valid}
                  onClick={() => void askForCode()}
                >
                  {busy && (codeFirst || !passkeys) && (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                  )}
                  {passkeyFirst ? t("orCode") : t("emailMeACode")}
                </Button>
              );
              return codeFirst
                ? [codeButton, passkeyButton]
                : [passkeyButton, codeButton];
            })()}

            {/*
              No mail server, so no code. A password still works: on a browser
              with no WebAuthn it is the only way, and even with a passkey on
              offer it stays a quiet tap away rather than something nobody can
              find. Signing up, the tap opens it on this step; signing in, it
              is the sign-in page, where a password can also be recovered.
            */}
            {!codeSignupAvailable &&
              (signingIn ? (
                <>
                  {!passkeys && (
                    <p className="text-sm text-pretty text-muted-foreground">
                      {t("noCredentialRoute")}
                    </p>
                  )}
                  <Button
                    asChild
                    size="lg"
                    variant={passkeys ? "ghost" : "outline"}
                    className={SECONDARY}
                  >
                    <Link href="/sign-in">{t("usePassword")}</Link>
                  </Button>
                </>
              ) : (
                <Button
                  size="lg"
                  variant="ghost"
                  className={SECONDARY}
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    refuse(null);
                    setPasswordChosen(true);
                  }}
                >
                  {t("usePasswordSignUp")}
                </Button>
              ))}
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
