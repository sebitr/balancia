"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { registerAction } from "@/modules/auth/actions";
import { useProofOfWork } from "@/components/auth/use-proof-of-work";
import { AppleSignInButton } from "./apple-sign-in-button";

/**
 * Field messages are catalogue keys rather than prose, translated at render
 * time — see `sign-in-form.tsx` for the same pattern.
 */
const schema = z
  .object({
    name: z.string().trim().min(1, "name").max(120),
    email: z.email("email"),
    password: z.string().min(10, "passwordMin").max(512, "passwordMax"),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "mismatch",
  });

type FormValues = z.infer<typeof schema>;

type ValidationKey =
  "name" | "email" | "passwordMin" | "passwordMax" | "mismatch";

export function RegisterForm({
  appleEnabled = false,
  guestName = null,
}: {
  appleEnabled?: boolean;
  /** The name the group already knows a guest by, prefilled for them. */
  guestName?: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("register");
  const tCommon = useTranslations("common");
  const tValidation = useTranslations("register.validation");
  const [formError, setFormError] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  // Starts hashing as soon as this renders, so on an instance that asks for a
  // proof of work the answer is ready long before anyone finishes typing. On
  // one that does not, this is a single request that answers "no" and stops.
  const { solution } = useProofOfWork();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: guestName ?? "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const fieldError = (field: keyof FormValues): string | null => {
    const message = form.formState.errors[field]?.message;
    return message ? tValidation(message as ValidationKey) : null;
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await registerAction({
      name: values.name,
      email: values.email,
      password: values.password,
      proofOfWork: await solution(),
    });

    if (!result.ok) {
      setFormError(result.error ?? t("createFailed"));
      return;
    }

    if (result.data?.verificationRequired) {
      // With SMTP configured the account needs email verification before it
      // can sign in, so show a confirmation notice instead of signing in. A
      // guest keeps their session until then; the claim lands on first sign-in.
      setVerificationSent(true);
      return;
    }

    // A guest whose group came across is shown what moved before anything else.
    const claimedGroupId = result.data?.claimedGroupId;
    router.push(
      claimedGroupId ? `/register/done?group=${claimedGroupId}` : "/dashboard",
    );
    router.refresh();
  });

  if (verificationSent) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("checkEmailTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t.rich("checkEmailBody", {
            email: () => (
              <span className="font-medium text-foreground">
                {form.getValues("email")}
              </span>
            ),
          })}
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">{t("backToSignIn")}</Link>
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
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="name">{t("name")}</Label>
          <Input
            id="name"
            autoComplete="name"
            // Also on the element, not only in `defaultValues`: that one is
            // applied on mount, so the server's HTML would otherwise ship an
            // empty field and fill it a frame later.
            defaultValue={guestName ?? undefined}
            aria-invalid={Boolean(form.formState.errors.name)}
            aria-describedby={
              form.formState.errors.name
                ? "name-error"
                : guestName
                  ? "name-hint"
                  : undefined
            }
            {...form.register("name")}
          />
          {guestName && !fieldError("name") && (
            <p id="name-hint" className="text-xs text-muted-foreground">
              {t("guestNameHint")}
            </p>
          )}
          {fieldError("name") && (
            <p id="name-error" className="text-sm text-destructive">
              {fieldError("name")}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
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
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
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

      {appleEnabled && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground uppercase">
              {tCommon("or")}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <AppleSignInButton intent="signUp" />
        </>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link
          href="/sign-in"
          className="text-foreground underline underline-offset-4"
        >
          {t("signIn")}
        </Link>
      </p>
    </div>
  );
}
