import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PreferredCurrencyForm } from "@/components/profile/preferred-currency-form";
import { FormatPreferencesForm } from "@/components/profile/format-preferences-form";
import { EmailAddressForm } from "@/components/profile/email-address-form";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/security/actor";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import { PUSH } from "@/components/motion/transitions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("metaTitle") };
}

/**
 * What /confirm-email redirects here with. An allowlist for the same reason
 * the sign-in page keeps one: `?emailChange=` is as easy to type as to be
 * sent, and it decides which stored message this page prints.
 */
const EMAIL_CHANGE_OUTCOMES = new Set(["changed", "taken", "invalid"]);

export default async function ProfilePage({
  searchParams,
}: PageProps<"/profile">) {
  const user = await getCurrentUser();
  const t = await getTranslations("profile");
  const tEmail = await getTranslations("emailChange");
  const mailEnabled = getEnv().smtpEnabled;

  const { emailChange } = await searchParams;
  const outcome =
    typeof emailChange === "string" && EMAIL_CHANGE_OUTCOMES.has(emailChange)
      ? emailChange
      : null;

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        {t("title")}
      </h1>

      {outcome && (
        <Alert variant={outcome === "changed" ? "default" : "destructive"}>
          <AlertDescription>
            {outcome === "changed"
              ? tEmail("confirmedNotice")
              : outcome === "taken"
                ? tEmail("takenNotice")
                : tEmail("invalidNotice")}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("account")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t("name")}</p>
            <p className="font-medium">{user?.name}</p>
          </div>
          {!mailEnabled && (
            <div>
              <p className="text-xs text-muted-foreground">{t("email")}</p>
              <p className="font-medium break-all">{user?.email}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("nameNote")}</p>
        </CardContent>
      </Card>

      {/* Changing an address means confirming it, and confirming it means mail.
          An instance without SMTP is shown the address in the card above and
          offered nothing it cannot deliver — the same answer the sign-in page
          gives about password recovery. */}
      {mailEnabled && user && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tEmail("title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <EmailAddressForm currentEmail={user.email} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("currencyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PreferredCurrencyForm
            defaultValue={
              user ? await getUserPreferredCurrency(user.userId) : null
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("formatsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FormatPreferencesForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("security")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("securityNote")}</p>
          <Button asChild variant="outline" size="sm">
            <Link href="/profile/security" transitionTypes={PUSH}>
              <ShieldCheck aria-hidden="true" />
              {t("managePasskeys")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
