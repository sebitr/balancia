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
import { resetPasswordAction } from "@/modules/auth/actions";

/**
 * Chooses the new password, using the token from the emailed link.
 *
 * The token is spent on submit, not on arrival: a link that is merely opened —
 * by a mail client prefetching it, say — must still work when its owner gets
 * round to typing. Success ends every other session, which is why the screen
 * that follows sends them back to sign in rather than into the app.
 */
const schema = z
  .object({
    password: z.string().min(10, "passwordMin").max(512, "passwordMax"),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "mismatch",
  });

type FormValues = z.infer<typeof schema>;

type ValidationKey = "passwordMin" | "passwordMax" | "mismatch";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("resetPassword");
  const tValidation = useTranslations("register.validation");
  const tErrors = useTranslations("auth.errors");
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const fieldError = (field: keyof FormValues): string | null => {
    const message = form.formState.errors[field]?.message;
    return message ? tValidation(message as ValidationKey) : null;
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await resetPasswordAction({
      token,
      password: values.password,
    });
    if (!result.ok) {
      setFormError(result.error ?? tErrors("generic"));
      return;
    }
    setDone(true);
  });

  if (done) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("doneTitle")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {t("doneBody")}
        </p>
        <Button asChild className="w-full">
          <Link href="/sign-in">{t("goToSignIn")}</Link>
        </Button>
      </div>
    );
  }

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
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            aria-invalid={Boolean(form.formState.errors.password)}
            aria-describedby="password-hint"
            {...form.register("password")}
          />
          <p id="password-hint" className="text-xs text-muted-foreground">
            {t("passwordHint")}
          </p>
          {fieldError("password") && (
            <p className="text-sm text-destructive">{fieldError("password")}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(form.formState.errors.confirmPassword)}
            {...form.register("confirmPassword")}
          />
          {fieldError("confirmPassword") && (
            <p className="text-sm text-destructive">
              {fieldError("confirmPassword")}
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
    </div>
  );
}
