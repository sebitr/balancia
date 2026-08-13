"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { registerAction } from "@/modules/auth/actions";

const schema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(120),
    email: z.email("Enter a valid email address"),
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(512, "That password is too long"),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords do not match",
  });

type FormValues = z.infer<typeof schema>;

export function RegisterForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await registerAction({
      name: values.name,
      email: values.email,
      password: values.password,
    });

    if (!result.ok) {
      setFormError(result.error ?? "That account could not be created.");
      return;
    }

    if (result.data?.verificationRequired) {
      // With SMTP configured the account needs email verification before it
      // can sign in, so show a confirmation notice instead of signing in.
      setVerificationSent(true);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  });

  if (verificationSent) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to{" "}
          <span className="font-medium text-foreground">
            {form.getValues("email")}
          </span>
          . Open it to finish setting up your account.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Create your account
        </h1>
        <p className="text-sm text-muted-foreground">
          You can add a passkey afterwards, from your account settings.
        </p>
      </div>

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            autoComplete="name"
            aria-invalid={Boolean(form.formState.errors.name)}
            aria-describedby={
              form.formState.errors.name ? "name-error" : undefined
            }
            {...form.register("name")}
          />
          {form.formState.errors.name && (
            <p id="name-error" className="text-sm text-destructive">
              {form.formState.errors.name.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
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
          {form.formState.errors.email && (
            <p id="email-error" className="text-sm text-destructive">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(form.formState.errors.password)}
            aria-describedby="password-hint"
            {...form.register("password")}
          />
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least 10 characters.
          </p>
          {form.formState.errors.password && (
            <p className="text-sm text-destructive">
              {form.formState.errors.password.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(form.formState.errors.confirmPassword)}
            {...form.register("confirmPassword")}
          />
          {form.formState.errors.confirmPassword && (
            <p className="text-sm text-destructive">
              {form.formState.errors.confirmPassword.message}
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
          Create account
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="text-foreground underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
