"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { signInAction } from "@/modules/auth/actions";
import { signInWithPasskey } from "@/modules/auth/passkey-client";
import { usePasskeySupport } from "./use-passkey-support";
import { AppleSignInButton } from "./apple-sign-in-button";

/**
 * Sign in with email and password, with a passkey, or with Apple.
 *
 * The passkey button uses a discoverable credential, so nothing has to be
 * typed first — the authenticator identifies the user. It is hidden entirely
 * on browsers without WebAuthn rather than offering a button that cannot work.
 * The Apple button is hidden on the same principle, on any instance whose
 * operator has not configured it.
 */

/**
 * Field messages are catalogue keys rather than prose; `zodResolver` hands
 * them to react-hook-form, which renders them through `t()` below. That keeps
 * one schema working in every language.
 */
const schema = z.object({
  email: z.email("email"),
  password: z.string().min(1, "password"),
});

type FormValues = z.infer<typeof schema>;

type ValidationKey = "email" | "password";

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
}: {
  mailEnabled: boolean;
  appleEnabled?: boolean;
  initialError?: string | null;
  initialNotice?: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("auth.signIn");
  const tValidation = useTranslations("auth.validation");
  const tErrors = useTranslations("auth.errors");
  const tCommon = useTranslations("common");
  const [formError, setFormError] = useState<string | null>(initialError);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const passkeysAvailable = usePasskeySupport();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const fieldError = (field: ValidationKey): string | null => {
    const message = form.formState.errors[field]?.message;
    return message ? tValidation(message as ValidationKey) : null;
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await signInAction(values);
    if (!result.ok) {
      setFormError(result.error ?? tErrors("generic"));
      return;
    }
    router.push("/dashboard");
    router.refresh();
  });

  const onPasskey = async () => {
    setFormError(null);
    setPasskeyPending(true);
    try {
      await signInWithPasskey();
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      // A cancelled prompt is not an error worth shouting about.
      const message =
        error instanceof Error && error.name === "NotAllowedError"
          ? tErrors("passkeyCancelled")
          : (error instanceof Error ? error.message : "") ||
            tErrors("passkeyFailed");
      setFormError(message);
    } finally {
      setPasskeyPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {initialNotice && !formError && (
        <Alert>
          <AlertDescription>{initialNotice}</AlertDescription>
        </Alert>
      )}

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username webauthn"
            aria-invalid={Boolean(form.formState.errors.email)}
            aria-describedby={
              form.formState.errors.email ? "email-error" : undefined
            }
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
            aria-describedby={
              form.formState.errors.password ? "password-error" : undefined
            }
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
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting && (
            <Loader2 aria-hidden="true" className="animate-spin" />
          )}
          {t("submit")}
        </Button>
      </form>

      {(passkeysAvailable || appleEnabled) && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground uppercase">
              {tCommon("or")}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            {passkeysAvailable && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
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
