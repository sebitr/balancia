import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PasskeyManager } from "@/components/auth/passkey-manager";
import { AppleAccountCard } from "@/components/auth/apple-account-card";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/security/actor";
import { getLinkedAppleIdentity } from "@/modules/auth/service";
import { POP } from "@/components/motion/transitions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("securityPage");
  return { title: t("metaTitle") };
}

/**
 * What the Apple round trip may redirect back with. An allowlist, for the same
 * reason as on the sign-in page: `?error=` is as easy to type as to be sent.
 */
const APPLE_ERROR_CODES = new Set([
  "appleFailed",
  "appleAlreadyLinked",
  "appleLinkedElsewhere",
  "generic",
]);

export default async function SecurityPage({
  searchParams,
}: PageProps<"/profile/security">) {
  const env = getEnv();
  const t = await getTranslations("securityPage");
  const tCommon = await getTranslations("common");
  const tApple = await getTranslations("appleAccount");

  const { error, linked: justLinked } = await searchParams;
  const code = typeof error === "string" ? error : undefined;
  let appleError: string | null = null;
  if (code && APPLE_ERROR_CODES.has(code)) {
    const tErrors = await getTranslations("serverErrors");
    const key = code as Parameters<typeof tErrors.has>[0];
    appleError = tErrors.has(key) ? tErrors(key) : tErrors("generic");
  }

  const user = env.appleSignInEnabled ? await getCurrentUser() : null;
  const linkedApple = user ? await getLinkedAppleIdentity(user.userId) : null;

  const isLocalhost =
    env.webAuthnRpId === "localhost" ||
    env.webAuthnRpId === "127.0.0.1" ||
    env.webAuthnRpId.endsWith(".localhost");
  const secureContext = env.appOrigin.startsWith("https://") || isLocalhost;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/profile" transitionTypes={POP}>
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

      {appleError && (
        <Alert variant="destructive">
          <AlertDescription>{appleError}</AlertDescription>
        </Alert>
      )}

      {justLinked === "apple" && !appleError && (
        <Alert>
          <AlertDescription>{tApple("linkedToast")}</AlertDescription>
        </Alert>
      )}

      <PasskeyManager
        relyingPartyId={env.webAuthnRpId}
        enabled={secureContext}
      />

      {env.appleSignInEnabled && (
        <AppleAccountCard
          linked={
            linkedApple
              ? {
                  email: linkedApple.email,
                  isPrivateEmail: linkedApple.isPrivateEmail,
                  linkedAt: linkedApple.linkedAt.toISOString(),
                }
              : null
          }
        />
      )}
    </div>
  );
}
