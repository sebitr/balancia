"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { signInAction } from "@/modules/auth/actions";
import { signInWithPasskey } from "@/modules/auth/passkey-client";
import { usePasskeySupport } from "./use-passkey-support";

/**
 * Sign in with email and password, or with a passkey.
 *
 * The passkey button uses a discoverable credential, so nothing has to be
 * typed first — the authenticator identifies the user. It is hidden entirely
 * on browsers without WebAuthn rather than offering a button that cannot work.
 */

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

type FormValues = z.infer<typeof schema>;

export function SignInForm({ mailEnabled }: { mailEnabled: boolean }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const passkeysAvailable = usePasskeySupport();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await signInAction(values);
    if (!result.ok) {
      setFormError(result.error ?? "That did not work.");
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
          ? "The passkey request was cancelled."
          : error instanceof Error
            ? error.message
            : "Your browser could not complete the passkey request.";
      setFormError(message);
    } finally {
      setPasskeyPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Welcome back
        </h1>
        <p className="text-sm text-muted-foreground">
          Sign in to see your groups and balances.
        </p>
      </div>

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
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
          {form.formState.errors.email && (
            <p id="email-error" className="text-sm text-destructive">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            {mailEnabled && (
              <Link
                href="/forgot-password"
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Forgot password?
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
          {form.formState.errors.password && (
            <p id="password-error" className="text-sm text-destructive">
              {form.formState.errors.password.message}
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
          Sign in
        </Button>
      </form>

      {passkeysAvailable && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground uppercase">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

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
            Sign in with a passkey
          </Button>
        </>
      )}

      <p className="text-center text-sm text-muted-foreground">
        No account yet?{" "}
        <Link
          href="/register"
          className="text-foreground underline underline-offset-4"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
