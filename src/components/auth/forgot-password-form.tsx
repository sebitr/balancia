"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requestPasswordResetAction } from "@/modules/auth/actions";

/**
 * Asks for the address a reset link should go to.
 *
 * The confirmation below is deliberately the same whether or not an account
 * exists, because the server deliberately behaves the same way: saying "no
 * such account" here would turn this form into a way to test whether an
 * address is registered. See `requestPasswordReset`.
 *
 * Field messages are catalogue keys rather than prose — see `sign-in-form.tsx`.
 */
const schema = z.object({ email: z.email("email") });

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const t = useTranslations("forgotPassword");
  const tValidation = useTranslations("auth.validation");
  const tErrors = useTranslations("auth.errors");
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await requestPasswordResetAction(values);
    if (!result.ok) {
      setFormError(result.error ?? tErrors("generic"));
      return;
    }
    setSentTo(values.email);
  });

  if (sentTo) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("sentTitle")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {t.rich("sentBody", {
            email: () => (
              <span className="font-medium text-foreground">{sentTo}</span>
            ),
          })}
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">{t("backToSignIn")}</Link>
        </Button>
      </div>
    );
  }

  const emailError = form.formState.errors.email?.message;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

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
            autoComplete="username"
            autoFocus
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "email-error" : undefined}
            {...form.register("email")}
          />
          {emailError && (
            <p id="email-error" className="text-sm text-destructive">
              {tValidation("email")}
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

      <p className="text-center text-sm text-muted-foreground">
        <Link
          href="/sign-in"
          className="text-foreground underline underline-offset-4"
        >
          {t("backToSignIn")}
        </Link>
      </p>
    </div>
  );
}
