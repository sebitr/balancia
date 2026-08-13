import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PasskeyManager } from "@/components/auth/passkey-manager";
import { getEnv } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("securityPage");
  return { title: t("metaTitle") };
}

export default async function SecurityPage() {
  const env = getEnv();
  const t = await getTranslations("securityPage");
  const tCommon = await getTranslations("common");
  const isLocalhost =
    env.webAuthnRpId === "localhost" ||
    env.webAuthnRpId === "127.0.0.1" ||
    env.webAuthnRpId.endsWith(".localhost");
  const secureContext = env.appOrigin.startsWith("https://") || isLocalhost;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/profile">
            <ArrowLeft aria-hidden="true" />
            {tCommon("back")}
          </Link>
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      {!secureContext && (
        <Alert variant="destructive">
          <AlertDescription>
            {t.rich("insecure", { code: () => <code>APP_URL</code> })}
          </AlertDescription>
        </Alert>
      )}

      <PasskeyManager
        relyingPartyId={env.webAuthnRpId}
        enabled={secureContext}
      />
    </div>
  );
}
