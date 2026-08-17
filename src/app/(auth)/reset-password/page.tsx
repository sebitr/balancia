import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("resetPassword");
  return { title: t("metaTitle") };
}

/**
 * The screen the emailed reset link opens.
 *
 * No session is required and none is assumed: the token is the whole of the
 * authorization, and the link is as likely to be opened on a phone the
 * instance has never seen as in the browser that asked for it. Whether the
 * token is any good is not decided here — that is the submit's job, in one
 * statement that consumes it (see `resetPassword`). All this page checks is
 * that there is something to submit.
 */
export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  const { token } = await searchParams;

  if (typeof token !== "string" || token.length === 0) {
    const t = await getTranslations("resetPassword");
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("noTokenTitle")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {t("noTokenBody")}
        </p>
        <Button asChild className="w-full">
          <Link href="/forgot-password">{t("askAgain")}</Link>
        </Button>
      </div>
    );
  }

  return <ResetPasswordForm token={token} />;
}
