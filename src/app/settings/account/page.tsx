import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { SettingsCard } from "@/components/settings/settings-card";
import { AvatarCard } from "@/components/settings/avatar-card";
import { DisplayNameForm } from "@/components/settings/display-name-form";
import { EmailCard } from "@/components/settings/email-card";
import { DangerCard } from "@/components/settings/danger-card";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/security/actor";
import { getAvatarVersion } from "@/modules/profile/avatar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("account") };
}

/**
 * What `/confirm-email` redirects here with. An allowlist for the same reason
 * the sign-in page keeps one: `?emailChange=` is as easy to type as to be
 * sent, and it decides which stored message this page prints.
 */
const EMAIL_CHANGE_OUTCOMES = new Set(["changed", "taken", "invalid"]);

export default async function AccountSettingsPage({
  searchParams,
}: PageProps<"/settings/account">) {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("userSettings");
  const tEmail = await getTranslations("emailChange");
  const mailEnabled = getEnv().smtpEnabled;

  const [photo, { emailChange }] = await Promise.all([
    getAvatarVersion(user.userId),
    searchParams,
  ]);

  const outcome =
    typeof emailChange === "string" && EMAIL_CHANGE_OUTCOMES.has(emailChange)
      ? emailChange
      : null;

  return (
    <SettingsScreen
      title={t("account")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
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

      <AvatarCard name={user.name} photoVersion={photo} />

      <SettingsCard>
        <DisplayNameForm initialName={user.name} />
      </SettingsCard>

      {/* Changing an address means confirming it, and confirming it means
          mail. An instance without SMTP is shown the address and offered
          nothing it cannot deliver — the same answer the sign-in page gives
          about password recovery. */}
      {mailEnabled ? (
        <EmailCard currentEmail={user.email} />
      ) : (
        <SettingsCard>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">{t("emailLabel")}</p>
            <p className="text-sm font-medium [overflow-wrap:anywhere]">
              {user.email}
            </p>
          </div>
        </SettingsCard>
      )}

      <DangerCard email={user.email} />
    </SettingsScreen>
  );
}
