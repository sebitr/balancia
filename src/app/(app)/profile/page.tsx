import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PreferredCurrencyForm } from "@/components/profile/preferred-currency-form";
import { getCurrentUser } from "@/lib/security/actor";
import { getUserPreferredCurrency } from "@/modules/auth/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("metaTitle") };
}

export default async function ProfilePage() {
  const user = await getCurrentUser();
  const t = await getTranslations("profile");

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        {t("title")}
      </h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("account")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t("name")}</p>
            <p className="font-medium">{user?.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("email")}</p>
            <p className="font-medium">{user?.email}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t("nameNote")}</p>
        </CardContent>
      </Card>

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
          <CardTitle className="text-base">{t("security")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("securityNote")}</p>
          <Button asChild variant="outline" size="sm">
            <Link href="/profile/security">
              <ShieldCheck aria-hidden="true" />
              {t("managePasskeys")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
