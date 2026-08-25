"use client";

import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requestEmailChangeAction } from "@/modules/auth/actions";

/**
 * The address on the account.
 *
 * The one card in settings that does not save as you type, because it does not
 * save at all: submitting sends a link to the address that was typed, and only
 * opening that link moves the account. So there is no toast and no Undo — the
 * card says the letter went, and the address above it is still the old one
 * until the change actually lands.
 *
 * Collapsed by default behind a Change pill. Almost nobody who opens this
 * screen came to change their address, and an open form with an empty field
 * reads as something left unfinished.
 *
 * Field messages are catalogue keys rather than prose — see `sign-in-form.tsx`.
 */
const schema = z.object({ email: z.email("email") });

type FormValues = z.infer<typeof schema>;

export function EmailCard({ currentEmail }: { currentEmail: string }) {
  const t = useTranslations("userSettings");
  const tEmail = useTranslations("emailChange");
  const tValidation = useTranslations("auth.validation");
  const tErrors = useTranslations("auth.errors");
  const fieldId = useId();

  const [open, setOpen] = useState(false);
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
    <section className="shrink-0 space-y-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs text-muted-foreground">{t("emailLabel")}</p>
          <p className="text-sm font-medium [overflow-wrap:anywhere]">
            {currentEmail}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((wasOpen) => !wasOpen);
            setFormError(null);
          }}
          className="inline-flex h-7 shrink-0 items-center rounded-full border border-input px-2.5 text-xs font-medium transition-colors hover:bg-foreground/6 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {open ? t("cancel") : t("emailChange")}
        </button>
      </div>

      {pendingEmail && (
        <Alert>
          <MailCheck aria-hidden="true" />
          <AlertDescription>
            {tEmail.rich("sentBody", {
              email: () => (
                <span className="font-medium [overflow-wrap:anywhere] text-foreground">
                  {pendingEmail}
                </span>
              ),
            })}
          </AlertDescription>
        </Alert>
      )}

      {open && (
        <form onSubmit={onSubmit} className="space-y-2.5" noValidate>
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <Input
            id={fieldId}
            type="email"
            autoComplete="email"
            placeholder={tEmail("placeholder")}
            aria-label={tEmail("newLabel")}
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? `${fieldId}-error` : undefined}
            className="h-10 rounded-xl"
            {...form.register("email")}
          />
          {emailError && (
            <p id={`${fieldId}-error`} className="text-xs text-destructive">
              {tValidation("email")}
            </p>
          )}

          <Button
            type="submit"
            disabled={form.formState.isSubmitting}
            className="h-10 w-full rounded-xl text-sm"
          >
            {form.formState.isSubmitting && (
              <Loader2 aria-hidden="true" className="animate-spin" />
            )}
            {pendingEmail ? tEmail("resubmit") : t("emailSend")}
          </Button>
          <p className="text-xs text-pretty text-muted-foreground">
            {t("emailHelp")}
          </p>
        </form>
      )}
    </section>
  );
}
