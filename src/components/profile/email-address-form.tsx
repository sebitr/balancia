"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requestEmailChangeAction } from "@/modules/auth/actions";

/**
 * Changes the address on the account.
 *
 * Nothing here changes anything: submitting sends a link to the address that
 * was typed, and only opening that link moves the account. So the form's
 * success state says "check that inbox" rather than "saved", and the address
 * shown above it is still the old one until the change actually lands.
 *
 * Field messages are catalogue keys rather than prose — see `sign-in-form.tsx`.
 */
const schema = z.object({ email: z.email("email") });

type FormValues = z.infer<typeof schema>;

export function EmailAddressForm({ currentEmail }: { currentEmail: string }) {
  const t = useTranslations("emailChange");
  const tValidation = useTranslations("auth.validation");
  const tErrors = useTranslations("auth.errors");
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await requestEmailChangeAction(values);
    if (!result.ok) {
      setFormError(result.error ?? tErrors("generic"));
      return;
    }
    // The server's normalized form, not the casing that was typed.
    setPendingEmail(result.data?.email ?? values.email);
    form.reset();
  });

  const emailError = form.formState.errors.email?.message;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t("currentLabel")}</p>
        <p className="text-sm font-medium break-all">{currentEmail}</p>
      </div>

      {pendingEmail ? (
        <Alert>
          <MailCheck aria-hidden="true" />
          <AlertDescription>
            {t.rich("sentBody", {
              email: () => (
                <span className="font-medium break-all text-foreground">
                  {pendingEmail}
                </span>
              ),
            })}
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">
          {t("intro")}
        </p>
      )}

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div className="space-y-2">
          <Label htmlFor="new-email">{t("newLabel")}</Label>
          <Input
            id="new-email"
            type="email"
            autoComplete="email"
            className="max-w-sm"
            placeholder={t("placeholder")}
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "new-email-error" : undefined}
            {...form.register("email")}
          />
          {emailError && (
            <p id="new-email-error" className="text-sm text-destructive">
              {tValidation("email")}
            </p>
          )}
        </div>

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && (
            <Loader2 aria-hidden="true" className="animate-spin" />
          )}
          {pendingEmail ? t("resubmit") : t("submit")}
        </Button>
      </form>
    </div>
  );
}
