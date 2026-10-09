"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { KeyRound, Loader2, Mail, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CodeInput } from "@/components/onboarding/code-input";
import { useResendCooldown } from "@/components/onboarding/use-resend-cooldown";
import {
  requestSignInCodeAction,
  signInAction,
  signInWithCodeAction,
} from "@/modules/auth/actions";
import { CODE_LENGTH } from "@/modules/auth/code-format";
import { startDemoAction } from "@/modules/demo/actions";
import {
  armPasskeyAutofill,
  cancelPasskeyCeremony,
  signInWithPasskey,
  supportsPasskeyAutofill,
  upgradeToPasskey,
} from "@/modules/auth/passkey-client";
import { cn } from "@/lib/utils";
import { usePasskeySupport } from "./use-passkey-support";
import { describedBy, useRefusalFocus } from "./use-refusal-focus";
import { AppleSignInButton } from "./apple-sign-in-button";

/**
 * Sign in with email and password, with a passkey, or with Apple.
 *
 * The passkey button uses a discoverable credential, so nothing has to be
 * typed first — the authenticator identifies the user. It is hidden entirely
 * on browsers without WebAuthn rather than offering a button that cannot work.
 * The Apple button is hidden on the same principle, on any instance whose
 * operator has not configured it.
 *
 * The same credential is also armed into the email field's autofill dropdown
 * on mount, where a returning reader meets it without having read the page —
 * see the effect below. The button stays, because most browsers still do not
 * offer conditional mediation and none of them announce it in the field.
 *
 * A password or a code that works also earns a passkey, silently, from the
 * password manager the reader just used — see `upgradeToPasskey`. It is
 * started and not waited for: they asked to sign in, so they are signed in,
 * and the ceremony finishes or does not while the dashboard loads.
 *
 * Where the instance can send mail, a six-digit code is the fourth way in,
 * and for an account created with a code or a passkey on another device it is
 * the only one this page can offer: such an account has no password, and
 * "Incorrect email or password" is the sentence it used to get. The code uses
 * the address already typed above, and takes the password field's place until
 * it lands.
 *
 * From `lg` the passkey leads, as the desktop board "19 · Sign in" draws it:
 * the filled button first, "or", then the address and password with their
 * submit stepped back to an outline. A desk is where a passkey in the
 * browser's own manager is the one-click way in. Only the drawing moves — the
 * button at the head and the one in the list below are the same handler, each
 * `display: none` at the other's widths, so one is ever on screen or in the
 * accessibility tree. Everything the form does is untouched.
 */

/**
 * The submit's filled look, stepped back to an outline from `lg` where the
 * passkey above it is the filled one.
 */
const OUTLINE_FROM_LG =
  "lg:h-10 lg:border-border lg:bg-background lg:text-foreground lg:hover:bg-muted";

/** Hydration is the only change being waited for, and it never repeats. */
const subscribeToNothing = (): (() => void) => () => {};

/** "or", ruled either side. */
function OrRule({ className }: { className?: string }) {
  const tCommon = useTranslations("common");
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground uppercase">
        {tCommon("or")}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Field messages are catalogue keys rather than prose; `zodResolver` hands
 * them to react-hook-form, which renders them through `t()` below. That keeps
 * one schema working in every language.
 */
const schema = z.object({
  email: z.email("email"),
  password: z.string().min(1, "password"),
});

/**
 * The same form on a demo instance, where the credential on the screen is
 * `demo` — not an address, and refused by the rule above. The server checks
 * for it before its own schema for the same reason.
 */
const demoSchema = z.object({
  email: z.string().min(1, "email"),
  password: z.string().min(1, "password"),
});

type FormValues = z.infer<typeof schema>;

type ValidationKey = "email" | "password";

/** Where the caret can be sent back to after a refusal. */
type RefusedField = "email" | "password" | "code";

/** The refusal's id, which the field it concerns is described by. */
const FORM_ERROR_ID = "sign-in-error";

export function SignInForm({
  mailEnabled,
  appleEnabled = false,
  /**
   * A failure from the Apple round trip, which cannot report itself: the
   * callback is a redirect, so the page it lands on has to carry the message.
   */
  initialError = null,
  /** The same, for something that went right — a confirmed address. */
  initialNotice = null,
  /**
   * The reader was sent here from a group's page. Say that the group is
   * private and what to ask for — never which group, or whether it exists.
   */
  privateGroup = false,
  /** This instance is a public demo: offer the way in, and say what it is. */
  demoMode = false,
  /**
   * Where a successful sign-in goes. The dashboard, unless the reader was sent
   * here from the consent screen of an AI agent they were connecting — see
   * `signInDestination`, which decides and is the only thing that may say so.
   */
  afterSignIn = "/dashboard",
}: {
  mailEnabled: boolean;
  appleEnabled?: boolean;
  initialError?: string | null;
  initialNotice?: string | null;
  privateGroup?: boolean;
  demoMode?: boolean;
  afterSignIn?: string;
}) {
  const router = useRouter();
  const t = useTranslations("auth.signIn");
  const tValidation = useTranslations("auth.validation");
  const tErrors = useTranslations("auth.errors");
  // The server answers in the reader's language and sends the sentence, not
  // the code, so recognising the one refusal worth retrying means comparing
  // against the same catalogue entry the route rendered.
  const tServerErrors = useTranslations("serverErrors");
  const tDemo = useTranslations("demo");
  const [formError, setFormError] = useState<string | null>(initialError);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [demoPending, setDemoPending] = useState(false);
  /** The address a sign-in code went to, which is what swaps the form over. */
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codePending, setCodePending] = useState(false);
  const resend = useResendCooldown();
  const passkeysAvailable = usePasskeySupport();
  /*
   * From `lg`, whether the passkey is drawn at the head of the form.
   *
   * Assumed on the server and through hydration, when the browser has not
   * been asked yet, rather than refused: a browser that can do passkeys —
   * nearly every one — then keeps the form where it was painted, and only one
   * that cannot loses the button afterwards. Read as "no" until asked, the
   * button would arrive after the first paint and push the fields down under
   * a cursor already on its way to them.
   */
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const passkeyFirst = !hydrated || passkeysAvailable;
  /** What the list of other ways in still holds from `lg`, once it has. */
  const othersAtLg = appleEnabled || (mailEnabled && !demoMode);

  const form = useForm<FormValues>({
    resolver: zodResolver(demoMode ? demoSchema : schema),
    defaultValues: { email: "", password: "" },
  });

  const fieldError = (field: ValidationKey): string | null => {
    const message = form.formState.errors[field]?.message;
    return message ? tValidation(message as ValidationKey) : null;
  };

  const codeField = useRef<HTMLInputElement>(null);
  const [refused, refuse] = useRefusalFocus<RefusedField>((field) => {
    if (field === "code") codeField.current?.focus();
    else form.setFocus(field, { shouldSelect: true });
  });

  /** The refusal, as the description of the field the caret was sent to. */
  const refusalFor = (field: RefusedField) =>
    formError && refused === field ? FORM_ERROR_ID : null;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    refuse(null);
    const result = await signInAction(values);
    if (!result.ok) {
      setFormError(result.error ?? tErrors("generic"));
      // The password, nearly always: "incorrect email or password" will not
      // say which, and the password is the half people mistype. An address
      // still waiting to be confirmed is the one refusal about the other
      // field. (A malformed address never gets this far — the schema stops it
      // and react-hook-form focuses the field itself.)
      refuse(result.code === "emailUnverified" ? "email" : "password");
      return;
    }
    // Not awaited: it shows nothing and can be slow, and nobody signing in
    // should wait on housekeeping they did not ask for.
    void upgradeToPasskey();
    router.push(afterSignIn);
    router.refresh();
  });

  /**
   * Mails a code to the address in the field, once the field says it is one.
   *
   * The action always reports success, so the screen swaps over whether or not
   * the address is registered: which addresses are is not this page's to say.
   */
  const requestCode = async () => {
    setFormError(null);
    refuse(null);
    // Into the field when it is the address that is wrong, as a submit would.
    if (!(await form.trigger("email", { shouldFocus: true }))) return;
    const email = form.getValues("email").trim();
    // Asked from the code screen, as a resend, the address field is gone and
    // the boxes are what is left to type into.
    const resending = codeSentTo !== null;
    setCodePending(true);
    try {
      const result = await requestSignInCodeAction({ email });
      if (!result.ok) {
        setFormError(result.error ?? tErrors("generic"));
        refuse(resending ? "code" : "email");
        return;
      }
      setCode("");
      setCodeSentTo(email);
      resend.start();
    } finally {
      setCodePending(false);
    }
  };

  const submitCode = async (value: string) => {
    if (!codeSentTo) return;
    setFormError(null);
    refuse(null);
    setCodePending(true);
    try {
      const result = await signInWithCodeAction({
        email: codeSentTo,
        code: value,
      });
      if (!result.ok) {
        setFormError(result.error ?? t("codeWrong"));
        // Emptied, and the caret back in it: the boxes were disabled while
        // the code was checked, which let go of focus.
        setCode("");
        refuse("code");
        return;
      }
      // A code leaves no credential behind at all, so this is the sign-in that
      // most needs the offer — the next device would otherwise start from the
      // inbox again.
      void upgradeToPasskey();
      router.push(afterSignIn);
      router.refresh();
    } finally {
      setCodePending(false);
    }
  };

  const onDemo = async () => {
    setFormError(null);
    refuse(null);
    setDemoPending(true);
    try {
      const result = await startDemoAction();
      if (!result.ok) {
        setFormError(result.error ?? tErrors("generic"));
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setDemoPending(false);
    }
  };

  /** One reading of a refused ceremony, for the button and for autofill. */
  const passkeyErrorMessage = (error: unknown): string =>
    // A cancelled prompt is not an error worth shouting about.
    error instanceof Error && error.name === "NotAllowedError"
      ? tErrors("passkeyCancelled")
      : (error instanceof Error ? error.message : "") ||
        tErrors("passkeyFailed");

  const onPasskey = async () => {
    setFormError(null);
    refuse(null);
    setPasskeyPending(true);
    try {
      await signInWithPasskey();
      router.push(afterSignIn);
      router.refresh();
    } catch (error) {
      setFormError(passkeyErrorMessage(error));
    } finally {
      setPasskeyPending(false);
    }
  };

  /*
   * What the armed request does when it settles.
   *
   * Effect events rather than dependencies: the request below is armed once
   * per mount and outlives every render after it, but the router and the
   * catalogue it answers to are the current ones.
   */
  const onAutofillSignedIn = useEffectEvent(() => {
    router.push(afterSignIn);
    router.refresh();
  });

  const onAutofillRefused = useEffectEvent((error: unknown) => {
    setFormError(passkeyErrorMessage(error));
    // About the passkey, not about anything typed: no field is described by it.
    refuse(null);
  });

  const isExpiredChallenge = useEffectEvent(
    (error: unknown): boolean =>
      error instanceof Error &&
      error.message === tServerErrors("passkeySignInExpired"),
  );

  /*
   * Put the passkey in the email field's autofill dropdown.
   *
   * Conditional mediation only works if something asks for it, and nothing
   * else on this page does: `autocomplete="username webauthn"` marks the field
   * but does not start a ceremony. So one is armed here, on a browser that
   * says it can, and then waits — indefinitely, invisibly, and without a
   * spinner, because the reader has not asked for anything yet.
   *
   * Which is also the rule for how it fails. Nobody is told about a request
   * they did not make: an abort is silent, and an expired challenge is
   * replaced rather than reported. Only what happens after they pick the
   * passkey out of the dropdown is theirs to hear about.
   */
  useEffect(() => {
    let cancelled = false;
    // One at a time. A second conditional ceremony would abort the first, and
    // "the previous request has settled" is what the visibility listener waits
    // for — a pending one is already offering the passkey.
    let pending = false;

    const arm = async (retryOnExpiry: boolean): Promise<void> => {
      if (cancelled || pending) return;
      pending = true;
      try {
        // False is the request declining to arm — a refused options handout,
        // which is not an arrival and not news.
        const signedIn = await armPasskeyAutofill();
        if (signedIn && !cancelled) onAutofillSignedIn();
      } catch (error) {
        if (cancelled) return;
        // Raised when the button starts its own modal ceremony, when this
        // screen unmounts, and once on React's development double-mount.
        if (error instanceof Error && error.name === "AbortError") return;
        /*
         * And `NotAllowedError`, which is the same silence for the same
         * reason. It is what a browser raises when there is no authenticator
         * to offer, and when somebody dismisses a prompt they never summoned —
         * so on the armed request it reports a refusal of something nobody
         * asked for. It was landing on the sign-in page as "That passkey
         * request was cancelled" above a form the reader had only just opened.
         *
         * The button keeps saying it, because there somebody pressed
         * something and is waiting to hear what happened.
         */
        if (error instanceof Error && error.name === "NotAllowedError") return;
        // The challenge lives five minutes and a sign-in page left open
        // outlives it. Fetch a fresh one — once, so that a server refusing
        // every challenge cannot turn this into a loop.
        if (retryOnExpiry && isExpiredChallenge(error)) {
          pending = false;
          await arm(false);
          return;
        }
        onAutofillRefused(error);
      } finally {
        pending = false;
      }
    };

    // Coming back to the tab, after the button cancelled the request or it
    // failed on its own: the field has nothing to offer until it is re-armed.
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") void arm(true);
    };

    void supportsPasskeyAutofill().then((supported) => {
      if (!supported || cancelled) return;
      document.addEventListener("visibilitychange", onVisibilityChange);
      void arm(true);
    });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      cancelPasskeyCeremony();
    };
    // No dependencies: one arming per mount, and the effect events above are
    // how the current router and catalogue reach it.
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* For somebody who followed a group's address and has no account to
          sign in with: the one thing this page can tell them that helps.
          Plain text in the reading colour rather than an alert — nothing went
          wrong, and the form below is still the way in for a member. */}
      {privateGroup && <p className="text-sm">{t("privateGroup")}</p>}

      {demoMode && (
        <div className="space-y-3 rounded-lg border border-dashed p-4">
          <p className="text-sm text-muted-foreground">{tDemo("signInBody")}</p>
          <Button
            type="button"
            className="w-full"
            onClick={() => void onDemo()}
            disabled={demoPending}
          >
            {demoPending ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <PlayCircle aria-hidden="true" />
            )}
            {tDemo("enter")}
          </Button>
        </div>
      )}

      {initialNotice && !formError && (
        <Alert>
          <AlertDescription>{initialNotice}</AlertDescription>
        </Alert>
      )}

      {formError && (
        <Alert id={FORM_ERROR_ID} variant="destructive">
          <AlertDescription>
            {formError}
            {/* The refusal a code-only account meets is "incorrect password",
                which is true and no help. The way out is on this screen, so
                the alert points at it. */}
            {mailEnabled && !codeSentTo && !demoMode && (
              <span className="mt-1 block text-muted-foreground">
                {t("noPasswordHint")}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* The passkey at the head of the form, from `lg` only. Below that it
          keeps its place among the other ways in, further down. */}
      {passkeyFirst && !codeSentTo && (
        <div className="hidden lg:block lg:space-y-6">
          <Button
            type="button"
            className="w-full lg:h-10"
            onClick={() => void onPasskey()}
            disabled={passkeyPending}
          >
            {passkeyPending ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <KeyRound aria-hidden="true" />
            )}
            {t("withPasskey")}
          </Button>
          <OrRule />
        </div>
      )}

      {codeSentTo ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("codeSent", { email: codeSentTo })}
          </p>
          <CodeInput
            ref={codeField}
            value={code}
            onChange={setCode}
            onComplete={(value) => void submitCode(value)}
            label={t("codeLabel")}
            disabled={codePending}
            autoFocus
            describedBy={describedBy(refusalFor("code"))}
          />
          <Button
            type="button"
            className="w-full"
            disabled={codePending || code.length < CODE_LENGTH}
            onClick={() => void submitCode(code)}
          >
            {codePending && (
              <Loader2 aria-hidden="true" className="animate-spin" />
            )}
            {t("submit")}
          </Button>
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={codePending || resend.remaining > 0}
              onClick={() => void requestCode()}
            >
              {resend.remaining > 0
                ? t("resendIn", { seconds: resend.remaining })
                : t("resend")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={codePending}
              onClick={() => {
                setCodeSentTo(null);
                setCode("");
                setFormError(null);
                refuse(null);
              }}
            >
              {t("usePassword")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username webauthn"
              aria-invalid={Boolean(form.formState.errors.email)}
              aria-describedby={describedBy(
                form.formState.errors.email && "email-error",
                refusalFor("email"),
              )}
              {...form.register("email")}
            />
            {fieldError("email") && (
              <p id="email-error" className="text-sm text-destructive">
                {fieldError("email")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("password")}</Label>
              {mailEnabled && (
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  {t("forgotPassword")}
                </Link>
              )}
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(form.formState.errors.password)}
              aria-describedby={describedBy(
                form.formState.errors.password && "password-error",
                refusalFor("password"),
              )}
              {...form.register("password")}
            />
            {fieldError("password") && (
              <p id="password-error" className="text-sm text-destructive">
                {fieldError("password")}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className={cn("w-full", passkeyFirst && OUTLINE_FROM_LG)}
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting && (
              <Loader2 aria-hidden="true" className="animate-spin" />
            )}
            {t("submit")}
          </Button>
        </form>
      )}

      {!codeSentTo && (passkeysAvailable || appleEnabled || mailEnabled) && (
        <>
          {/* From `lg`, where the passkey and its "or" lead the form, what
              is left here follows the submit without a second "or". */}
          <OrRule className={cn(passkeyFirst && "lg:hidden")} />

          <div
            className={cn(
              "space-y-2",
              passkeyFirst && !othersAtLg && "lg:hidden",
            )}
          >
            {passkeysAvailable && (
              <Button
                type="button"
                variant="outline"
                className={cn("w-full", passkeyFirst && "lg:hidden")}
                onClick={() => void onPasskey()}
                disabled={passkeyPending}
              >
                {passkeyPending ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <KeyRound aria-hidden="true" />
                )}
                {t("withPasskey")}
              </Button>
            )}

            {mailEnabled && !demoMode && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void requestCode()}
                disabled={codePending}
              >
                {codePending ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <Mail aria-hidden="true" />
                )}
                {t("emailMeACode")}
              </Button>
            )}

            {appleEnabled && <AppleSignInButton intent="signIn" />}
          </div>
        </>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {t("noAccount")}{" "}
        <Link
          href="/register"
          className="text-foreground underline underline-offset-4"
        >
          {t("createOne")}
        </Link>
      </p>
    </div>
  );
}
