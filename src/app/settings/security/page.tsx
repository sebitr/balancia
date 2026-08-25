import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { PasskeysCard } from "@/components/settings/passkeys-card";
import { FallbacksCard } from "@/components/settings/fallbacks-card";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/security/actor";
import { getLinkedAppleIdentity, hasPassword } from "@/modules/auth/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("security") };
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

export default async function SecuritySettingsPage({
  searchParams,
}: PageProps<"/settings/security">) {
  const user = await getCurrentUser();
  if (!user) return null;

  const env = getEnv();
  const t = await getTranslations("userSettings");
  const tApple = await getTranslations("appleAccount");

  const { error, linked: justLinked } = await searchParams;
  const code = typeof error === "string" ? error : undefined;
  let appleError: string | null = null;
  if (code && APPLE_ERROR_CODES.has(code)) {
    const tErrors = await getTranslations("serverErrors");
    const key = code as Parameters<typeof tErrors.has>[0];
    appleError = tErrors.has(key) ? tErrors(key) : tErrors("generic");
  }

  const [password, apple] = await Promise.all([
    hasPassword(user.userId),
    env.appleSignInEnabled ? getLinkedAppleIdentity(user.userId) : null,
  ]);

  // WebAuthn refuses to run outside a secure context, and an operator who has
  // put Balancia on plain http has a configuration problem rather than a
  // browser one — so the screen says which, instead of offering a button that
  // fails silently.
  const isLocalhost =
    env.webAuthnRpId === "localhost" ||
    env.webAuthnRpId === "127.0.0.1" ||
    env.webAuthnRpId.endsWith(".localhost");
  const secureContext = env.appOrigin.startsWith("https://") || isLocalhost;

  return (
    <SettingsScreen
      title={t("security")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      <p className="shrink-0 px-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
        {t("securityIntro")}
      </p>

      {!secureContext && (
        <Alert variant="destructive">
          <AlertDescription>
            {t.rich("securityInsecure", { code: () => <code>APP_URL</code> })}
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

      <PasskeysCard
        relyingPartyId={env.webAuthnRpId}
        secureContext={secureContext}
      />

      <FallbacksCard
        hasPassword={password}
        appleEnabled={env.appleSignInEnabled}
        appleLinked={apple !== null}
      />
    </SettingsScreen>
  );
}
